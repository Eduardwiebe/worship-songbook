#!/usr/bin/env python3
"""
Structured OCR for leadsheet pages.

Primary: RapidOCR (PaddleOCR det/rec models via ONNX, CPU).
Fallback: Tesseract TSV (word boxes).

OCR tokens are raw data only (text, bbox, confidence). Staff systems are
detected geometrically from the page image so reconstruction can assign
chord / notation / lyric zones without using RapidOCR reading order as song text.

Output JSON (stdout):
{
  "engine": "rapidocr"|"tesseract-tsv",
  "pages": [{
    "page_index": 0,
    "width": 1200,
    "height": 1600,
    "tokens": [{ "text", "bbox": [x0,y0,x1,y1], "confidence", "line_index" }],
    "systems": [{ "index", "y0", "y1", "spacing", "score" }]
  }],
  "elapsed_ms": 123
}
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

OCR_PYTHON = os.environ.get(
    "SONGBOOK_OCR_PYTHON",
    str(Path(__file__).resolve().parent / ".venv-ocr" / "bin" / "python"),
)
_RAPID_OCR = None


def _bbox_from_poly(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]


def _assign_line_indices(tokens):
    """Cluster tokens into reading-order lines by vertical overlap.

    This index is diagnostic only. Reconstruction must not treat it as
    the song reading order — parallel lyric tracks share similar Y values.
    """
    if not tokens:
        return tokens
    ordered = sorted(tokens, key=lambda t: ((t["bbox"][1] + t["bbox"][3]) / 2, t["bbox"][0]))
    lines = []
    for token in ordered:
        cy = (token["bbox"][1] + token["bbox"][3]) / 2
        height = max(token["bbox"][3] - token["bbox"][1], 1)
        placed = False
        for line in lines:
            ref = line[0]
            rcy = (ref["bbox"][1] + ref["bbox"][3]) / 2
            rh = max(ref["bbox"][3] - ref["bbox"][1], 1)
            if abs(cy - rcy) <= max(height, rh) * 0.65:
                line.append(token)
                placed = True
                break
        if not placed:
            lines.append([token])
    for index, line in enumerate(lines):
        line.sort(key=lambda t: t["bbox"][0])
        for token in line:
            token["line_index"] = index
    return ordered


def detect_staff_systems(gray: np.ndarray) -> list[dict]:
    """Find 5-line staves via horizontal ink projection + equal-spacing template.

    Returns systems top-to-bottom: {index, y0, y1, spacing, score}.
    Downstream reconstruction uses these to cut chord / notation / lyric zones.
    """
    if gray.ndim != 2:
        raise ValueError("detect_staff_systems expects a grayscale array")

    height, width = gray.shape
    if height < 80 or width < 80:
        return []

    x0, x1 = int(width * 0.14), int(width * 0.92)
    mid = gray[:, x0:x1]
    ink = (mid < 185).astype(np.float32)
    proj = ink.mean(axis=1)
    proj = np.convolve(proj, np.ones(3) / 3.0, mode="same")

    spacing_min = max(8, int(height * 0.004))
    spacing_max = max(spacing_min + 1, int(height * 0.012))
    candidates: list[tuple[float, int, int, int]] = []

    for spacing in range(spacing_min, spacing_max + 1):
        usable = height - 4 * spacing
        if usable < 16:
            continue
        layers = np.stack([proj[i * spacing : i * spacing + usable] for i in range(5)])
        between = np.stack(
            [proj[i * spacing + spacing // 2 : i * spacing + spacing // 2 + usable] for i in range(4)]
        )
        vmin = layers.min(axis=0)
        vmean = layers.mean(axis=0)
        score = vmin * 0.4 + vmean * 0.6 - between.mean(axis=0)
        peaks = np.where((score > 0.12) & (vmin > 0.08))[0]
        if peaks.size == 0:
            continue
        for y in peaks.tolist():
            if y > 0 and score[y] < score[y - 1]:
                continue
            if y + 1 < usable and score[y] < score[y + 1]:
                continue
            candidates.append((float(score[y]), int(y), int(y + 4 * spacing), int(spacing)))

    candidates.sort(reverse=True)
    picked: list[tuple[float, int, int, int]] = []
    for item in candidates:
        _sc, y0, y1, _spacing = item
        if any(not (y1 < other[1] - 8 or y0 > other[2] + 8) for other in picked):
            continue
        picked.append(item)
        if len(picked) >= 16:
            break

    picked.sort(key=lambda item: item[1])
    return [
        {
            "index": index,
            "y0": y0,
            "y1": y1,
            "spacing": spacing,
            "score": round(score, 3),
        }
        for index, (score, y0, y1, spacing) in enumerate(picked)
    ]


def _page_arrays(image_path: Path):
    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    gray = np.asarray(image.convert("L"), dtype=np.uint8)
    return width, height, gray


def _rapid_engine():
    global _RAPID_OCR
    if _RAPID_OCR is None:
        from rapidocr_onnxruntime import RapidOCR

        _RAPID_OCR = RapidOCR()
    return _RAPID_OCR


def rapidocr_page(image_path: Path):
    width, height, gray = _page_arrays(image_path)
    ocr = _rapid_engine()
    result, _elapse = ocr(str(image_path))
    tokens = []
    for row in result or []:
        poly, text, conf = row[0], row[1], float(row[2])
        text = (text or "").strip()
        if not text:
            continue
        tokens.append(
            {
                "text": text,
                "bbox": _bbox_from_poly(poly),
                "confidence": conf,
            }
        )
    tokens = _assign_line_indices(tokens)
    return {
        "width": width,
        "height": height,
        "tokens": tokens,
        "systems": detect_staff_systems(gray),
    }


def tesseract_tsv_page(image_path: Path):
    width, height, gray = _page_arrays(image_path)
    proc = subprocess.run(
        [
            "/usr/bin/tesseract",
            str(image_path),
            "stdout",
            "-l",
            "deu+eng",
            "--psm",
            "4",
            "-c",
            "preserve_interword_spaces=1",
            "tsv",
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=120,
    )
    tokens = []
    lines = proc.stdout.splitlines()
    if len(lines) < 2:
        return {"width": width, "height": height, "tokens": [], "systems": detect_staff_systems(gray)}
    header = lines[0].split("\t")
    idx = {name: i for i, name in enumerate(header)}
    for row in lines[1:]:
        cols = row.split("\t")
        if len(cols) <= max(idx.values()):
            continue
        level = cols[idx.get("level", 0)]
        if level != "5":  # word
            continue
        text = cols[idx.get("text", -1)].strip()
        if not text:
            continue
        try:
            conf = float(cols[idx["conf"]])
            left = float(cols[idx["left"]])
            top = float(cols[idx["top"]])
            w = float(cols[idx["width"]])
            h = float(cols[idx["height"]])
        except (KeyError, ValueError):
            continue
        if conf < 0:
            continue
        tokens.append(
            {
                "text": text,
                "bbox": [left, top, left + w, top + h],
                "confidence": conf / 100.0,
            }
        )
    # Tesseract's line_num restarts in each block/paragraph. Using it alone
    # merges unrelated lyrics. Re-cluster the complete page geometrically.
    tokens = _assign_line_indices(tokens)
    return {
        "width": width,
        "height": height,
        "tokens": tokens,
        "systems": detect_staff_systems(gray),
    }


def run_engine(image_paths):
    started = time.time()
    engine = "rapidocr"
    pages = []
    try:
        for index, path in enumerate(image_paths):
            page = rapidocr_page(Path(path))
            page["page_index"] = index
            pages.append(page)
    except Exception as rapid_err:
        engine = "tesseract-tsv"
        pages = []
        for index, path in enumerate(image_paths):
            page = tesseract_tsv_page(Path(path))
            page["page_index"] = index
            page["fallback_error"] = str(rapid_err)
            pages.append(page)

    return {
        "engine": engine,
        "pages": pages,
        "elapsed_ms": int((time.time() - started) * 1000),
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: ocr_structured.py image [image...]"}))
        sys.exit(2)
    paths = sys.argv[1:]
    for path in paths:
        if not Path(path).is_file():
            print(json.dumps({"error": f"missing file: {path}"}))
            sys.exit(1)
    print(json.dumps(run_engine(paths), ensure_ascii=False))


if __name__ == "__main__":
    main()
