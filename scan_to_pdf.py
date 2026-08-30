import sys
from PIL import Image, ImageEnhance, ImageOps

output, *inputs = sys.argv[1:]
pages = []
for source in inputs:
    with Image.open(source) as image:
        page = ImageOps.exif_transpose(image).convert("RGB")
        # Moderate automatic correction keeps logos and chord symbols intact.
        page = ImageOps.autocontrast(page, cutoff=0.4)
        page = ImageEnhance.Contrast(page).enhance(1.08)
        if page.width < 1800:
            ratio = 1800 / page.width
            page = page.resize((1800, round(page.height * ratio)), Image.Resampling.LANCZOS)
        pages.append(page.copy())

if not pages:
    raise SystemExit("Keine Scan-Seiten")
pages[0].save(output, "PDF", resolution=300, save_all=True, append_images=pages[1:], quality=95)
