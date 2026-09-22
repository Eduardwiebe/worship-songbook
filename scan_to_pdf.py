#!/usr/bin/env python3
"""Convert scan images to a multi-page Original PDF.

Each photo is page-detected, deskewed, and cropped when a sheet is visible.
Photos that already fill the frame (VisionKit or a prior crop) stay full-frame.

Uses Pillow only. OpenCV is not required. On the server, run this with the
OCR virtualenv (it already installs Pillow) or any Python that has Pillow.
"""

import sys
from pathlib import Path

from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError

ImageFile.LOAD_TRUNCATED_IMAGES = True

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan_document import correct_document_page

MAX_LONG_SIDE = 3600
MIN_WIDTH = 2200


def prepare_page(source: str) -> Image.Image:
    try:
        with Image.open(source) as image:
            page = ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        print(f"scan_to_pdf: cannot read {source}: {exc}", file=sys.stderr)
        raise SystemExit("Bildformat wird nicht unterstützt. Bitte JPEG oder PNG verwenden.") from exc

    try:
        corrected, meta = correct_document_page(page)
    except Exception as exc:
        print(f"scan_document: deskew-fallback {source}: {exc}", file=sys.stderr)
        corrected = page
        meta = {"reason": "deskew-fallback"}

    corrected = _fit_page(corrected)
    print(
        f"scan_document: {meta.get('reason', 'full-frame')} {source} -> {corrected.size[0]}x{corrected.size[1]}",
        file=sys.stderr,
    )
    return corrected


def _fit_page(page: Image.Image) -> Image.Image:
    if max(page.size) > MAX_LONG_SIDE:
        ratio = MAX_LONG_SIDE / max(page.size)
        page = page.resize(
            (max(2, round(page.width * ratio)), max(2, round(page.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    if page.width < MIN_WIDTH and page.height > 0:
        ratio = MIN_WIDTH / page.width
        if round(page.height * ratio) > MAX_LONG_SIDE:
            ratio = MAX_LONG_SIDE / page.height
        page = page.resize(
            (max(2, round(page.width * ratio)), max(2, round(page.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    return page


def main(argv: list[str]) -> None:
    if len(argv) < 3:
        raise SystemExit("Keine Scan-Seiten")
    output, *inputs = argv[1:]
    pages = [prepare_page(source) for source in inputs]
    if not pages:
        raise SystemExit("Keine Scan-Seiten")
    pages[0].save(
        output,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=pages[1:],
        quality=95,
        optimize=False,
    )


if __name__ == "__main__":
    try:
        main(sys.argv)
    except SystemExit:
        raise
    except Exception as exc:
        print(f"scan_to_pdf: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
