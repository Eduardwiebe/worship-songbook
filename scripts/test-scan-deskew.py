#!/usr/bin/env python3
"""Deskew/crop checks for photographed Original pages (no chord OCR)."""

import math
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scan_document import correct_document_page, detect_document_quad, perspective_coefficients  # noqa: E402


def fail(message):
    raise SystemExit(message)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def make_sheet(width=900, height=1200):
    page = Image.new("RGB", (width, height), (248, 246, 240))
    draw = ImageDraw.Draw(page)
    for y in range(70, height - 80, 34):
        draw.rectangle((48, y, width - 48, y + 3), fill=(18, 18, 18))
    # Near-edge mark must survive a full-frame pass (no accidental crop).
    draw.rectangle((24, 16, width - 24, 22), fill=(12, 12, 12))
    # Horizontal bar used to measure deskew.
    draw.rectangle((60, 480, width - 60, 508), fill=(8, 8, 8))
    draw.rectangle((width // 2 - 36, height // 2 - 36, width // 2 + 36, height // 2 + 36), fill=(10, 18, 140))
    return page


def paste_homography(canvas, page, dest_quad):
    pw, ph = page.size
    coeffs = perspective_coefficients(
        dest_quad,
        [(0, 0), (pw - 1, 0), (pw - 1, ph - 1), (0, ph - 1)],
    )
    if coeffs is None:
        fail("synthetic homography was singular")
    warped = page.transform(canvas.size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BICUBIC, fillcolor=(0, 0, 0))
    mask = Image.new("L", page.size, 255).transform(
        canvas.size, Image.Transform.PERSPECTIVE, coeffs, Image.Resampling.BILINEAR, fillcolor=0
    )
    canvas.paste(warped, (0, 0), mask)
    return canvas


def darkest_row_balance(image):
    """Mean Y of dark pixels on the left third vs the right third."""
    gray = image.convert("L")
    w, h = gray.size
    px = gray.load()
    left = []
    right = []
    for y in range(h):
        for x in range(int(w * 0.18), int(w * 0.42)):
            if px[x, y] < 80:
                left.append(y)
        for x in range(int(w * 0.58), int(w * 0.82)):
            if px[x, y] < 80:
                right.append(y)
    if len(left) < 20 or len(right) < 20:
        fail("deskew check could not see the staff lines")
    return sum(left) / len(left), sum(right) / len(right)


def corner_means(image, band=12):
    rgb = image.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    means = []
    boxes = (
        (0, 0, band, band),
        (w - band, 0, w, band),
        (w - band, h - band, w, h),
        (0, h - band, band, h),
    )
    for x0, y0, x1, y1 in boxes:
        total = 0
        count = 0
        for y in range(y0, y1):
            for x in range(x0, x1):
                r, g, b = px[x, y]
                total += (r + g + b) / 3
                count += 1
        means.append(total / max(count, 1))
    return means


def test_perspective_photo():
    page = make_sheet()
    canvas = Image.new("RGB", (1400, 1800), (42, 36, 32))
    quad = [(190, 250), (1180, 150), (1240, 1580), (150, 1500)]
    paste_homography(canvas, page, quad)
    corrected, meta = correct_document_page(canvas)
    if not meta.get("detected"):
        fail(f"perspective photo was not detected: {meta}")
    means = corner_means(corrected)
    if min(means) < 180:
        fail(f"cropped corners still include the table: {means}")
    if corrected.width >= canvas.width - 20 and corrected.height >= canvas.height - 20:
        fail(f"perspective photo was not cropped: {corrected.size}")
    left, right = darkest_row_balance(corrected)
    if abs(left - right) > corrected.height * 0.035:
        fail(f"page is still skewed: left {left:.1f} right {right:.1f}")
    # The blue marker must survive near the middle.
    px = corrected.convert("RGB").load()
    found = False
    w, h = corrected.size
    for y in range(int(h * 0.35), int(h * 0.65)):
        for x in range(int(w * 0.35), int(w * 0.65)):
            r, g, b = px[x, y]
            if b > 80 and b > r + 25:
                found = True
                break
        if found:
            break
    if not found:
        fail("center marker was cropped away")
    print("OK perspective photo detected, deskewed, and cropped")


def test_rotated_page():
    page = make_sheet(800, 1060)
    rotated = page.rotate(14, expand=True, fillcolor=(36, 32, 30), resample=Image.Resampling.BICUBIC)
    canvas = Image.new("RGB", (rotated.width + 220, rotated.height + 220), (36, 32, 30))
    canvas.paste(rotated, (110, 110))
    corrected, meta = correct_document_page(canvas)
    if not meta.get("detected"):
        fail(f"rotated page was not detected: {meta}")
    left, right = darkest_row_balance(corrected)
    if abs(left - right) > corrected.height * 0.04:
        fail(f"rotation remains: left {left:.1f} right {right:.1f} h={corrected.height}")
    print("OK rotated page deskewed")


def test_full_frame_kept():
    page = make_sheet(1000, 1400)
    corrected, meta = correct_document_page(page)
    if meta.get("detected"):
        fail(f"full-bleed sheet should stay full frame, got {meta}")
    if abs(corrected.width - page.width) > 2 or abs(corrected.height - page.height) > 2:
        fail(f"full-bleed size changed: {corrected.size}")
    gray = corrected.convert("L")
    px = gray.load()
    dark = 0
    for x in range(30, gray.width - 30):
        for y in range(8, 36):
            if px[x, y] < 90:
                dark += 1
    if dark < 40:
        fail("full-bleed pass clipped the top staff line")
    print("OK full-frame sheet kept")


def test_second_pass_stable():
    page = make_sheet()
    canvas = Image.new("RGB", (1300, 1700), (40, 38, 36))
    paste_homography(canvas, page, [(160, 220), (1120, 180), (1160, 1500), (140, 1460)])
    once, meta = correct_document_page(canvas)
    if not meta.get("detected"):
        fail("first pass did not detect")
    twice, meta2 = correct_document_page(once)
    if meta2.get("detected"):
        area_once = once.width * once.height
        area_twice = twice.width * twice.height
        if area_twice < area_once * 0.9:
            fail(f"second pass cropped again: {once.size} -> {twice.size}")
    print("OK second pass does not recrop a straightened page")


def test_text_holes_do_not_split_page():
    page = make_sheet(860, 1100)
    canvas = Image.new("RGB", (1200, 1500), (50, 46, 42))
    paste_homography(canvas, page, [(140, 180), (1040, 210), (1000, 1320), (180, 1280)])
    quad = detect_document_quad(canvas)
    if not quad:
        fail("text on the sheet hid the page")
    # Detected corners should sit near the pasted quad, not on a text strip.
    expected = [(140, 180), (1040, 210), (1000, 1320), (180, 1280)]
    for corner, target in zip(quad, expected):
        if dist(corner, target) > 48:
            fail(f"corner {corner} too far from {target}")
    print("OK printed text does not split the page")


def test_pdf_script_writes_pdf():
    import subprocess

    page = make_sheet(700, 900)
    canvas = Image.new("RGB", (1000, 1300), (44, 40, 36))
    paste_homography(canvas, page, [(80, 120), (900, 90), (940, 1180), (70, 1140)])
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "page.jpg"
        out = Path(tmp) / "out.pdf"
        canvas.save(src, quality=90)
        proc = subprocess.run(
            ["python3", str(ROOT / "scan_to_pdf.py"), str(out), str(src)],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            fail(f"scan_to_pdf.py failed: {proc.stderr}")
        if "deskew-crop" not in proc.stderr:
            fail(f"scan_to_pdf.py did not deskew the photo: {proc.stderr}")
        data = out.read_bytes()
        if not data.startswith(b"%PDF"):
            fail("scan_to_pdf.py did not write a PDF")
    print("OK scan_to_pdf.py writes a PDF")


def main():
    test_perspective_photo()
    test_rotated_page()
    test_full_frame_kept()
    test_second_pass_stable()
    test_text_holes_do_not_split_page()
    test_pdf_script_writes_pdf()
    print("All scan deskew checks passed")


if __name__ == "__main__":
    main()
