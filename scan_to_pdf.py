#!/usr/bin/env python3
"""Convert scan images to a high-quality multi-page PDF without cropping content."""

import sys
from PIL import Image, ImageOps

output, *inputs = sys.argv[1:]
pages = []
for source in inputs:
    with Image.open(source) as image:
        page = ImageOps.exif_transpose(image).convert("RGB")
        # Preserve full frame — no crop. Light autocontrast only.
        page = ImageOps.autocontrast(page, cutoff=0.2)
        # Upscale small pages for OCR/readability; never downscale large VisionKit pages.
        if page.width < 2200:
            ratio = 2200 / page.width
            page = page.resize((2200, round(page.height * ratio)), Image.Resampling.LANCZOS)
        pages.append(page.copy())

if not pages:
    raise SystemExit("Keine Scan-Seiten")

# Save PDF at high quality; also keep first page PNG sidecar when env asks — handled by server.
pages[0].save(
    output,
    "PDF",
    resolution=300,
    save_all=True,
    append_images=pages[1:],
    quality=95,
    optimize=False,
)
