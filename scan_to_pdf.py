#!/usr/bin/env python3
"""Convert scan images to a multi-page Original PDF.

Each photo is page-detected, deskewed, and cropped when a sheet is visible.
Photos that already fill the frame (VisionKit or a prior crop) stay full-frame.
"""

import sys
from pathlib import Path

from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan_document import correct_document_page

output, *inputs = sys.argv[1:]
pages = []
for source in inputs:
    with Image.open(source) as image:
        page = ImageOps.exif_transpose(image).convert("RGB")
        page, meta = correct_document_page(page)
        if page.width < 2200:
            ratio = 2200 / page.width
            page = page.resize((2200, round(page.height * ratio)), Image.Resampling.LANCZOS)
        pages.append(page.copy())
        print(
            f"scan_document: {meta.get('reason', 'full-frame')} {source} -> {page.size[0]}x{page.size[1]}",
            file=sys.stderr,
        )

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
