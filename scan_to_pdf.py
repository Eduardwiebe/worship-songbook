#!/usr/bin/env python3
"""Convert scan images to a multi-page Original PDF.

Each photo is page-detected, deskewed, and cropped when a sheet is visible.
Photos that already fill the frame (VisionKit or a prior crop) stay full-frame.

Uses Pillow only. OpenCV is not required. On the server, run this with the
OCR virtualenv (it already installs Pillow) or any Python that has Pillow.
"""

import sys
import zlib
from pathlib import Path

from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError

ImageFile.LOAD_TRUNCATED_IMAGES = True

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scan_document import correct_document_page

MAX_LONG_SIDE = 4600


def prepare_page(source: str, preserve: bool = False) -> Image.Image:
    try:
        with Image.open(source) as image:
            page = ImageOps.exif_transpose(image).convert("RGB")
    except (UnidentifiedImageError, OSError) as exc:
        print(f"scan_to_pdf: cannot read {source}: {exc}", file=sys.stderr)
        raise SystemExit("Bildformat wird nicht unterstützt. Bitte JPEG oder PNG verwenden.") from exc

    try:
        corrected, meta = (page, {"reason": "reviewed-original"}) if preserve else correct_document_page(page)
    except Exception as exc:
        print(f"scan_document: deskew-fallback {source}: {exc}", file=sys.stderr)
        corrected = page
        meta = {"reason": "deskew-fallback"}

    corrected = corrected if preserve else _fit_page(corrected)
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
    return page


def write_reviewed_pdf(output, sources, pages):
    """Embed reviewed JPEG bytes directly; use lossless RGB for other formats.

    No second JPEG generation, resampling, contrast change or inferred crop.
    EXIF-rotated sources use oriented lossless RGB so every viewer agrees.
    """
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b""]
    kids = []
    for source, page in zip(sources, pages):
        width, height = page.size
        payload = zlib.compress(page.tobytes())
        encoding, colour = b"/FlateDecode", b"/DeviceRGB"
        with Image.open(source) as original:
            if original.format == "JPEG" and original.mode in ("RGB", "L") and original.getexif().get(274, 1) == 1:
                payload = Path(source).read_bytes()
                encoding = b"/DCTDecode"
                colour = b"/DeviceGray" if original.mode == "L" else b"/DeviceRGB"
        page_id = len(objects) + 1
        image_id, content_id = page_id + 1, page_id + 2
        kids.append(f"{page_id} 0 R")
        pw, ph = width * 72 / 300, height * 72 / 300
        commands = f"q {pw:.6f} 0 0 {ph:.6f} 0 0 cm /Scan Do Q\n".encode()
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw:.6f} {ph:.6f}] /Resources << /XObject << /Scan {image_id} 0 R >> >> /Contents {content_id} 0 R >>".encode())
        objects.append(f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /BitsPerComponent 8 /ColorSpace ".encode() + colour + b" /Filter " + encoding + f" /Length {len(payload)} >>\nstream\n".encode() + payload + b"\nendstream")
        objects.append(f"<< /Length {len(commands)} >>\nstream\n".encode() + commands + b"endstream")
    objects[1] = f"<< /Type /Pages /Count {len(kids)} /Kids [{' '.join(kids)}] >>".encode()
    with open(output, "wb") as pdf:
        pdf.write(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for index, obj in enumerate(objects, 1):
            offsets.append(pdf.tell())
            pdf.write(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
        xref = pdf.tell()
        pdf.write(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
        for offset in offsets[1:]:
            pdf.write(f"{offset:010d} 00000 n \n".encode())
        pdf.write(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())


def main(argv: list[str]) -> None:
    if len(argv) < 3:
        raise SystemExit("Keine Scan-Seiten")
    output, *inputs = argv[1:]
    preserve = bool(inputs and inputs[0] == "--preserve")
    if preserve:
        inputs = inputs[1:]
    pages = [prepare_page(source, preserve=preserve) for source in inputs]
    if not pages:
        raise SystemExit("Keine Scan-Seiten")
    if preserve:
        write_reviewed_pdf(output, inputs, pages)
        return
    pages[0].save(
        output,
        "PDF",
        resolution=300,
        save_all=True,
        append_images=pages[1:],
        quality=100,
        subsampling=0,
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
