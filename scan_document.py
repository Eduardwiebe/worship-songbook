"""Detect a photographed page, deskew it, and crop to the sheet.

Camera and gallery imports are ordinary photos. iOS VisionKit already returns a
perspective-corrected page; this module is the same step for HTML camera,
gallery images, and any photo that still contains the table around the sheet.

The crop is conservative: when no reliable page quad is found, the full frame
is kept. Chord/LeadSheet OCR is not part of this step.
"""

from __future__ import annotations

import math
from PIL import Image, ImageOps

ANALYSIS_LONG_SIDE = 640
MIN_AREA_RATIO = 0.12
MAX_AREA_RATIO = 0.975
BORDER_FRAC = 0.06
# Pull the quad slightly inward so the antialiased table edge is not kept.
EXPAND = -0.008
MIN_ANGLE = 38.0
MAX_ANGLE = 148.0
MIN_ASPECT = 0.32
MAX_ASPECT = 2.9


def correct_document_page(image: Image.Image) -> tuple[Image.Image, dict]:
    """Return (rgb_image, meta). meta['detected'] is True when a page was cropped."""
    rgb = image.convert("RGB")
    quad = detect_document_quad(rgb)
    if not quad:
        enhanced = _enhance(rgb, straightened=False)
        return enhanced, {"detected": False, "reason": "full-frame"}

    warped = warp_quad(rgb, quad)
    if warped is None:
        enhanced = _enhance(rgb, straightened=False)
        return enhanced, {"detected": False, "reason": "warp-rejected"}

    enhanced = _enhance(warped, straightened=True)
    return enhanced, {
        "detected": True,
        "reason": "deskew-crop",
        "quad": [(round(x, 1), round(y, 1)) for x, y in quad],
        "size": enhanced.size,
    }


def detect_document_quad(image: Image.Image):
    """Return ordered (tl, tr, br, bl) in source pixels, or None."""
    rgb = image.convert("RGB")
    width, height = rgb.size
    if width < 20 or height < 20:
        return None

    scale = min(1.0, ANALYSIS_LONG_SIDE / max(width, height))
    aw = max(2, int(round(width * scale)))
    ah = max(2, int(round(height * scale)))
    small = rgb.resize((aw, ah), Image.Resampling.BILINEAR)
    gray_image = ImageOps.grayscale(small)
    gray = list(gray_image.get_flattened_data() if hasattr(gray_image, "get_flattened_data") else gray_image.getdata())
    quad = _detect_quad_gray(gray, aw, ah)
    if not quad:
        return None

    inv = 1.0 / scale
    mapped = [(x * inv, y * inv) for x, y in quad]
    mapped = _expand_quad(mapped, width, height, EXPAND)
    if _nearly_full_frame(mapped, width, height):
        return None
    if not _quad_ok(mapped, width, height):
        return None
    return mapped


def warp_quad(image: Image.Image, quad) -> Image.Image | None:
    rgb = image.convert("RGB")
    width, height = rgb.size
    if not _quad_ok(quad, width, height):
        return None
    tl, tr, br, bl = quad
    out_w = int(round(max(_dist(tl, tr), _dist(bl, br))))
    out_h = int(round(max(_dist(tl, bl), _dist(tr, br))))
    out_w = max(2, min(out_w, 4600))
    out_h = max(2, min(out_h, 4600))
    if out_w < min(width, height) * 0.18 or out_h < min(width, height) * 0.18:
        return None

    coeffs = perspective_coefficients(
        [(0, 0), (out_w - 1, 0), (out_w - 1, out_h - 1), (0, out_h - 1)],
        [tl, tr, br, bl],
    )
    if coeffs is None:
        return None
    return rgb.transform(
        (out_w, out_h),
        Image.Transform.PERSPECTIVE,
        coeffs,
        Image.Resampling.BICUBIC,
        fillcolor=(255, 255, 255),
    )


def perspective_coefficients(output_points, input_points):
    """Map output pixels onto input pixels (PIL PERSPECTIVE order)."""
    matrix = []
    target = []
    for (x, y), (u, v) in zip(output_points, input_points):
        matrix.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        target.append(u)
        matrix.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        target.append(v)
    try:
        solved = _solve(matrix, target)
    except ValueError:
        return None
    return tuple(solved)


def _detect_quad_gray(gray: list[int], width: int, height: int):
    threshold = _choose_threshold(gray, width, height)
    if threshold is None:
        return None

    mask = bytearray(1 if value >= threshold else 0 for value in gray)
    mask = _fill_holes(mask, width, height)
    component = _largest_component(mask, width, height)
    if component is None:
        return None
    if len(component) < MIN_AREA_RATIO * width * height:
        return None

    points = _extreme_points(component, width)
    ordered = _order_quad(points)
    if ordered is None:
        return None

    area = _polygon_area(ordered)
    if area < MIN_AREA_RATIO * width * height or area > MAX_AREA_RATIO * width * height:
        return None
    if len(component) / area < 0.55:
        return None
    if not _quad_ok(ordered, width, height):
        return None
    if _nearly_full_frame(ordered, width, height):
        return None
    return ordered


def _choose_threshold(gray: list[int], width: int, height: int):
    margin = max(1, int(round(min(width, height) * BORDER_FRAC)))
    border = []
    for y in range(0, height, 2):
        row = y * width
        for x in range(0, width, 2):
            if x < margin or y < margin or x >= width - margin or y >= height - margin:
                border.append(gray[row + x])
    if not border:
        return None
    border.sort()
    median = border[len(border) // 2]
    # Bright borders mean the sheet already fills the photo (VisionKit / prior crop).
    if median >= 176:
        return None

    otsu = _otsu(gray)
    threshold = int(round(max(median + 22, median * 0.45 + otsu * 0.55)))
    threshold = max(median + 16, min(threshold, median + 78, 210))
    if threshold >= 250:
        return None
    return threshold


def _otsu(data: list[int]) -> int:
    hist = [0] * 256
    for value in data:
        hist[value] += 1
    total = len(data)
    sum_all = sum(index * count for index, count in enumerate(hist))
    sum_bg = 0
    weight_bg = 0
    best_var = -1.0
    best = 127
    for level in range(256):
        weight_bg += hist[level]
        if weight_bg == 0:
            continue
        weight_fg = total - weight_bg
        if weight_fg == 0:
            break
        sum_bg += level * hist[level]
        mean_bg = sum_bg / weight_bg
        mean_fg = (sum_all - sum_bg) / weight_fg
        var = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
        if var > best_var:
            best_var = var
            best = level
    return best


def _fill_holes(mask: bytearray, width: int, height: int) -> bytearray:
    seen = bytearray(width * height)
    stack = []

    def push(index: int):
        if mask[index] == 0 and not seen[index]:
            seen[index] = 1
            stack.append(index)

    for x in range(width):
        push(x)
        push((height - 1) * width + x)
    for y in range(height):
        push(y * width)
        push(y * width + width - 1)

    while stack:
        current = stack.pop()
        x = current % width
        y = current // width
        if x > 0:
            push(current - 1)
        if x + 1 < width:
            push(current + 1)
        if y > 0:
            push(current - width)
        if y + 1 < height:
            push(current + width)

    filled = bytearray(mask)
    for index, value in enumerate(mask):
        if value == 0 and not seen[index]:
            filled[index] = 1
    return filled


def _largest_component(mask: bytearray, width: int, height: int):
    seen = bytearray(width * height)
    best = None
    best_count = 0
    for start, value in enumerate(mask):
        if not value or seen[start]:
            continue
        stack = [start]
        seen[start] = 1
        count = 0
        pixels = []
        while stack:
            current = stack.pop()
            pixels.append(current)
            count += 1
            x = current % width
            y = current // width
            if x > 0:
                nxt = current - 1
                if mask[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    stack.append(nxt)
            if x + 1 < width:
                nxt = current + 1
                if mask[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    stack.append(nxt)
            if y > 0:
                nxt = current - width
                if mask[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    stack.append(nxt)
            if y + 1 < height:
                nxt = current + width
                if mask[nxt] and not seen[nxt]:
                    seen[nxt] = 1
                    stack.append(nxt)
        if count > best_count:
            best = pixels
            best_count = count
    return best


def _extreme_points(component, width: int):
    def xy(index):
        return (index % width, index // width)

    best = {"tl": None, "tr": None, "br": None, "bl": None}
    best_score = {"tl": None, "tr": None, "br": None, "bl": None}
    for index in component:
        x, y = xy(index)
        candidates = {
            "tl": (x + y, x, y),
            "tr": (-(x - y), -x, y),
            "br": (-(x + y), -x, y),
            "bl": (x - y, x, y),
        }
        for key, score in candidates.items():
            if best_score[key] is None or score < best_score[key]:
                best_score[key] = score
                best[key] = (x, y)
    return [best["tl"], best["tr"], best["br"], best["bl"]]


def _order_quad(points):
    if any(point is None for point in points):
        return None
    unique = []
    for point in points:
        if all(_dist(point, other) > 2.5 for other in unique):
            unique.append(point)
    if len(unique) != 4:
        return None
    sums = [p[0] + p[1] for p in unique]
    diffs = [p[0] - p[1] for p in unique]
    tl = unique[min(range(4), key=lambda i: (sums[i], unique[i][0]))]
    br = unique[max(range(4), key=lambda i: (sums[i], unique[i][0]))]
    tr = unique[max(range(4), key=lambda i: (diffs[i], unique[i][0]))]
    bl = unique[min(range(4), key=lambda i: (diffs[i], unique[i][0]))]
    ordered = [tl, tr, br, bl]
    if len({(p[0], p[1]) for p in ordered}) < 4:
        return None
    return ordered


def _quad_ok(quad, width: int, height: int) -> bool:
    if not quad or len(quad) != 4:
        return False
    if len({(round(p[0], 2), round(p[1], 2)) for p in quad}) < 4:
        return False
    tl, tr, br, bl = quad
    sides = (_dist(tl, tr), _dist(tr, br), _dist(br, bl), _dist(bl, tl))
    shortest = min(width, height)
    if min(sides) < shortest * 0.12:
        return False
    out_w = max(sides[0], sides[2])
    out_h = max(sides[1], sides[3])
    aspect = out_w / max(out_h, 0.001)
    if aspect < MIN_ASPECT or aspect > MAX_ASPECT:
        return False
    angles = (
        _angle(bl, tl, tr),
        _angle(tl, tr, br),
        _angle(tr, br, bl),
        _angle(br, bl, tl),
    )
    if any(angle < MIN_ANGLE or angle > MAX_ANGLE for angle in angles):
        return False
    area = _polygon_area(quad)
    if area < MIN_AREA_RATIO * width * height * 0.5:
        return False
    return True


def _nearly_full_frame(quad, width: int, height: int) -> bool:
    area = _polygon_area(quad)
    if area >= MAX_AREA_RATIO * width * height:
        return True
    tolerance = 0.03 * min(width, height)
    corners = [(0, 0), (width - 1, 0), (width - 1, height - 1), (0, height - 1)]
    return all(_dist(quad[i], corners[i]) <= tolerance for i in range(4))


def _expand_quad(quad, width: int, height: int, amount: float):
    cx = sum(point[0] for point in quad) / 4
    cy = sum(point[1] for point in quad) / 4
    expanded = []
    for x, y in quad:
        nx = min(width - 1, max(0, x + (x - cx) * amount))
        ny = min(height - 1, max(0, y + (y - cy) * amount))
        expanded.append((nx, ny))
    return expanded


def _enhance(page: Image.Image, straightened: bool) -> Image.Image:
    cutoff = 0.35 if straightened else 0.2
    return ImageOps.autocontrast(page, cutoff=cutoff)


def _polygon_area(points) -> float:
    area = 0.0
    count = len(points)
    for index in range(count):
        x1, y1 = points[index]
        x2, y2 = points[(index + 1) % count]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _angle(a, b, c) -> float:
    v1 = (a[0] - b[0], a[1] - b[1])
    v2 = (c[0] - b[0], c[1] - b[1])
    n1 = math.hypot(*v1)
    n2 = math.hypot(*v2)
    if n1 < 1e-6 or n2 < 1e-6:
        return 0.0
    cos = max(-1.0, min(1.0, (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def _solve(matrix, target):
    size = len(target)
    rows = [list(map(float, matrix[i])) + [float(target[i])] for i in range(size)]
    for col in range(size):
        pivot = max(range(col, size), key=lambda row: abs(rows[row][col]))
        if abs(rows[pivot][col]) < 1e-10:
            raise ValueError("singular")
        rows[col], rows[pivot] = rows[pivot], rows[col]
        divisor = rows[col][col]
        for col_index in range(col, size + 1):
            rows[col][col_index] /= divisor
        for row in range(size):
            if row == col:
                continue
            factor = rows[row][col]
            if factor == 0:
                continue
            for col_index in range(col, size + 1):
                rows[row][col_index] -= factor * rows[col][col_index]
    return [rows[i][size] for i in range(size)]
