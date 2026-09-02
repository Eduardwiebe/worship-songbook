#!/usr/bin/env python3
"""
OMR-first page understanding via Audiveris.

Primary structure comes from the .omr book (staves, chord names, sentence roles).
RapidOCR tokens are merged only as text fill into those staff zones.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from ocr_structured import _assign_line_indices, rapidocr_page

ROOT = Path(__file__).resolve().parent
AUDIVERIS = os.environ.get("SONGBOOK_AUDIVERIS", str(ROOT / ".opt/audiveris/bin/Audiveris"))
TESSDATA = os.environ.get("SONGBOOK_TESSDATA", str(ROOT / ".opt/tessdata"))


def _bounds(el):
    b = el.find("bounds")
    if b is None:
        return None
    x = float(b.get("x", 0))
    y = float(b.get("y", 0))
    w = float(b.get("w", 0))
    h = float(b.get("h", 0))
    return [x, y, x + w, y + h]


def _staff_y_range(staff_el):
    ys = []
    for point in staff_el.findall("./lines/line/point"):
        ys.append(float(point.get("y", 0)))
    if not ys:
        return None
    return min(ys), max(ys)


def parse_omr_book(omr_path: Path, width: int, height: int) -> dict:
    with zipfile.ZipFile(omr_path) as archive:
        names = [name for name in archive.namelist() if name.endswith("sheet#1.xml") or "/sheet#" in name and name.endswith(".xml")]
        if not names:
            names = [name for name in archive.namelist() if name.endswith(".xml") and "sheet" in name]
        if not names:
            raise FileNotFoundError("no sheet xml in omr")
        root = ET.fromstring(archive.read(sorted(names)[0]))

    systems = []
    for index, staff in enumerate(root.iter("staff")):
        yrange = _staff_y_range(staff)
        if not yrange:
            continue
        y0, y1 = yrange
        systems.append(
            {
                "index": len(systems),
                "y0": int(round(y0)),
                "y1": int(round(y1)),
                "spacing": int(round((y1 - y0) / 4)) if y1 > y0 else 20,
                "score": 1.0,
                "omr_staff": staff.get("id"),
            }
        )
        if len(systems) >= 16:
            break

    tokens = []
    for word in root.iter("word"):
        bbox = _bounds(word)
        text = (word.get("value") or "").strip()
        if not text or bbox is None:
            continue
        tokens.append(
            {
                "text": text,
                "bbox": bbox,
                "confidence": float(word.get("grade") or 0.7),
                "source": "audiveris-word",
                "staff": word.get("staff"),
            }
        )

    for chord in root.iter("chord-name"):
        bbox = _bounds(chord)
        text = normalize_chord_text(chord.get("value") or "")
        if not text or bbox is None:
            continue
        tokens.append(
            {
                "text": text,
                "bbox": bbox,
                "confidence": float(chord.get("grade") or 0.7),
                "source": "audiveris-chord",
                "staff": chord.get("staff"),
            }
        )

    for sentence in root.iter("sentence"):
        role = sentence.get("role") or ""
        bbox = _bounds(sentence)
        if bbox is None:
            continue
        if role in {"Title", "Rights", "Direction", "UnknownRole", "ChordName"}:
            tokens.append(
                {
                    "text": "",
                    "bbox": bbox,
                    "confidence": float(sentence.get("grade") or 0.5),
                    "source": "audiveris-role",
                    "role": role,
                    "staff": sentence.get("staff"),
                }
            )

    # Role markers without text are layout hints only; drop empty text.
    tokens = [token for token in tokens if token["text"] or token.get("role") == "Title"]
    # Attach title role to overlapping words
    title_boxes = [_bounds(s) for s in root.iter("sentence") if s.get("role") == "Title"]
    rights_boxes = [_bounds(s) for s in root.iter("sentence") if s.get("role") == "Rights"]
    for token in tokens:
        if token.get("source") == "audiveris-role":
            continue
        cx = (token["bbox"][0] + token["bbox"][2]) / 2
        cy = (token["bbox"][1] + token["bbox"][3]) / 2
        for box in title_boxes:
            if box and box[0] <= cx <= box[2] and box[1] <= cy <= box[3]:
                token["role"] = "Title"
        for box in rights_boxes:
            if box and box[0] <= cx <= box[2] and box[1] <= cy <= box[3]:
                token["role"] = "Rights"

    tokens = [token for token in tokens if token.get("text") and token.get("role") != "Rights"]
    tokens = _assign_line_indices(tokens)
    return {
        "width": width,
        "height": height,
        "tokens": tokens,
        "systems": systems,
        "omr_word_count": sum(1 for token in tokens if token.get("source") == "audiveris-word"),
        "omr_chord_count": sum(1 for token in tokens if token.get("source") == "audiveris-chord"),
    }


def _overlap_ratio(a, b):
    x0 = max(a[0], b[0])
    y0 = max(a[1], b[1])
    x1 = min(a[2], b[2])
    y1 = min(a[3], b[3])
    if x1 <= x0 or y1 <= y0:
        return 0.0
    inter = (x1 - x0) * (y1 - y0)
    area = max((a[2] - a[0]) * (a[3] - a[1]), 1)
    return inter / area


def _in_notation(token, systems):
    cy = (token["bbox"][1] + token["bbox"][3]) / 2
    for staff in systems:
        if staff["y0"] - 4 <= cy <= staff["y1"] + 4:
            return True
    return False


CHORD_RE = re.compile(
    r"^(?:[CDEFGABH](?:is|es|#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:/[CDEFGABH](?:is|es|#|b)?)?)$"
)


def normalize_chord_text(value: str) -> str:
    text = (value or "").strip()
    text = text.replace("♯", "#").replace("♭", "b").replace("＃", "#")
    text = re.sub(r"\s*/\s*", "/", text)
    if text.startswith("(") and text.endswith(")") and "/" in text:
        text = text[1:-1].strip()
    return text


def is_chord_text(text: str) -> bool:
    return bool(CHORD_RE.match(normalize_chord_text(text)))


def is_plausible_short_token(text: str) -> bool:
    value = (text or "").strip()
    return value in {"C", "D", "E", "F", "G", "A", "B", "H", "1", "2"} or is_chord_text(value)


def merge_rapidocr(omr_page: dict, image_path: Path) -> dict:
    try:
        ocr = rapidocr_page(image_path)
    except Exception:
        return omr_page

    omr_tokens = omr_page["tokens"]
    keep = [
        token for token in omr_tokens
        if token.get("source") == "audiveris-chord"
        or str(token.get("text") or "").lower() in {"refrain", "chorus", "bridge", "verse", "strophe"}
    ]

    extras = []
    for token in ocr.get("tokens") or []:
        raw = str(token.get("text") or "").strip()
        if _in_notation(token, omr_page["systems"]) and not is_chord_text(raw):
            continue
        extras.append({**token, "source": "rapidocr-fill"})

    covered_y = [
        ((token["bbox"][1] + token["bbox"][3]) / 2, token["bbox"][0], token["bbox"][2])
        for token in extras
    ]
    recovered = []
    for token in omr_tokens:
        if token in keep:
            continue
        if token.get("source") != "audiveris-word":
            continue
        text = str(token.get("text") or "")
        if len(text) <= 1 and not is_plausible_short_token(text):
            continue
        cy = (token["bbox"][1] + token["bbox"][3]) / 2
        if any(abs(cy - other[0]) <= 22 and token["bbox"][0] < other[2] and token["bbox"][2] > other[1] for other in covered_y):
            continue
        recovered.append(token)

    omr_page["tokens"] = _assign_line_indices(keep + extras + recovered)
    if not omr_page["systems"] and ocr.get("systems"):
        omr_page["systems"] = ocr["systems"]
    omr_page["fill_token_count"] = len(extras)
    return omr_page


def run_audiveris(image_path: Path, out_dir: Path) -> Path:
    if not Path(AUDIVERIS).is_file():
        raise FileNotFoundError(f"Audiveris not found: {AUDIVERIS}")
    out_dir.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["TESSDATA_PREFIX"] = TESSDATA
    proc = subprocess.run(
        [
            AUDIVERIS,
            "-batch",
            "-transcribe",
            "-export",
            "-save",
            "-constant",
            "org.audiveris.omr.text.Language.locale=deu+eng",
            "-output",
            str(out_dir),
            str(image_path),
        ],
        capture_output=True,
        text=True,
        timeout=180,
        env=env,
    )
    omr = out_dir / f"{image_path.stem}.omr"
    if not omr.is_file():
        raise RuntimeError(proc.stderr[-2000:] or proc.stdout[-2000:] or "Audiveris produced no .omr")
    return omr


def process_page(image_path: Path) -> dict:
    from PIL import Image

    image = Image.open(image_path).convert("RGB")
    width, height = image.size
    with tempfile.TemporaryDirectory(prefix="songbook-omr-") as tmp:
        omr_path = run_audiveris(image_path, Path(tmp))
        page = parse_omr_book(omr_path, width, height)
    page["page_index"] = 0
    return merge_rapidocr(page, image_path)


def run_engine(image_paths):
    started = time.time()
    pages = []
    error = None
    try:
        for index, path in enumerate(image_paths):
            page = process_page(Path(path))
            page["page_index"] = index
            pages.append(page)
        engine = "audiveris"
    except Exception as exc:
        engine = "rapidocr-fallback"
        error = str(exc)
        pages = []
        for index, path in enumerate(image_paths):
            page = rapidocr_page(Path(path))
            page["page_index"] = index
            page["omr_error"] = error
            pages.append(page)
    return {
        "engine": engine,
        "pages": pages,
        "elapsed_ms": int((time.time() - started) * 1000),
        "omr_error": error,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: omr_structured.py image [image...]"}))
        sys.exit(2)
    if sys.argv[1] == "--parse-omr":
        omr = Path(sys.argv[2])
        width = int(sys.argv[3])
        height = int(sys.argv[4])
        print(json.dumps(parse_omr_book(omr, width, height), ensure_ascii=False))
        return
    paths = sys.argv[1:]
    for path in paths:
        if not Path(path).is_file():
            print(json.dumps({"error": f"missing file: {path}"}))
            sys.exit(1)
    print(json.dumps(run_engine(paths), ensure_ascii=False))


if __name__ == "__main__":
    main()
