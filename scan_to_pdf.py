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
        if page.width < 2400:
            ratio = 2400 / page.width
            page = page.resize((2400, round(page.height * ratio)), Image.Resampling.LANCZOS)
        page = ImageEnhance.Sharpness(page).enhance(1.25)
        page = ImageEnhance.Contrast(page).enhance(1.12)
        pages.append(page.copy())

if not pages:
    raise SystemExit("Keine Scan-Seiten")
pages[0].save(output, "PDF", resolution=300, save_all=True, append_images=pages[1:], quality=95, optimize=False)
