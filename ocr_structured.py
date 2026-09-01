#!/usr/bin/env python3
"""
Structured OCR for leadsheet pages.

Primary: RapidOCR (PaddleOCR det/rec models via ONNX, CPU).
Fallback: Tesseract TSV (word boxes).

Output JSON (stdout):
{
  "engine": "rapidocr"|"tesseract-tsv",
  "pages": [{
    "page_index": 0,
    "width": 1200,
    "height": 1600,
    "tokens": [{ "text", "bbox": [x0,y0,x1,y1], "confidence", "line_index" }]
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

OCR_PYTHON = os.environ.get(
    "SONGBOOK_OCR_PYTHON",
    str(Path(__file__).resolve().parent / ".venv-ocr" / "bin" / "python"),
)


def _bbox_from_poly(poly):
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [float(min(xs)), float(min(ys)), float(max(xs)), float(max(ys))]


def _assign_line_indices(tokens):
    """Cluster tokens into reading-order lines by vertical overlap."""
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


def rapidocr_page(image_path: Path):
    # Import inside worker to keep cold-start isolation
    from PIL import Image
    from rapidocr_onnxruntime import RapidOCR

    image = Image.open(image_path)
    width, height = image.size
    ocr = RapidOCR()
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
    }


def tesseract_tsv_page(image_path: Path):
    from PIL import Image

    image = Image.open(image_path)
    width, height = image.size
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
        return {"width": width, "height": height, "tokens": []}
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
            line_num = int(cols[idx.get("line_num", 0)] or 0)
        except (KeyError, ValueError):
            continue
        if conf < 0:
            continue
        tokens.append(
            {
                "text": text,
                "bbox": [left, top, left + w, top + h],
                "confidence": conf / 100.0,
                "line_index": line_num,
            }
        )
    if tokens and all("line_index" in t for t in tokens):
        # normalize line indices to contiguous
        mapping = {}
        next_i = 0
        for t in sorted(tokens, key=lambda x: (x["line_index"], x["bbox"][0])):
            if t["line_index"] not in mapping:
                mapping[t["line_index"]] = next_i
                next_i += 1
            t["line_index"] = mapping[t["line_index"]]
    else:
        tokens = _assign_line_indices(tokens)
    return {"width": width, "height": height, "tokens": tokens}


def run_engine(image_paths):
    started = time.time()
    engine = "rapidocr"
    pages = []
    try:
        # Prefer RapidOCR in dedicated venv via in-process import when already that interpreter
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
