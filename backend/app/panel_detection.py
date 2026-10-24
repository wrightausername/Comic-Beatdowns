"""Conservative local panel detection for straight, pale comic gutters.

Returns suggestions only. The original image stays unchanged until a user accepts.
Irregular/inset, dark and gutterless pages intentionally require manual review.
"""

from PIL import Image, ImageOps


def _bands(flags, minimum):
    runs = []
    start = None
    for i, flag in enumerate([*flags, False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            if i - start >= minimum:
                runs.append((start, i))
            start = None
    return runs


def _splits(image, axis):
    width, height = image.size
    span = height if axis == "horizontal" else width
    other = width if axis == "horizontal" else height
    if span < 190 or other < 100:
        return []
    thumb = image.copy()
    thumb.thumbnail((900, 900))
    gray = thumb.convert("L")
    tw, th = thumb.size
    scan = th if axis == "horizontal" else tw
    across = tw if axis == "horizontal" else th
    pixels = gray.load()
    bright = []
    for pos in range(scan):
        count = sum(
            pixels[n, pos] >= 245 if axis == "horizontal" else pixels[pos, n] >= 245
            for n in range(across)
        )
        bright.append(count / across >= 0.975)
    gutters = _bands(bright, max(3, round(scan * 0.007)))
    # Ignore the pale margin around a page. Only clear interior gutters count.
    candidates = [
        (a, b) for a, b in gutters if a > scan * 0.12 and b < scan * 0.88 and b - a <= scan * 0.09
    ]
    if not candidates:
        return []
    edges = [0]
    for a, b in candidates:
        edges += [round(a * span / scan), round(b * span / scan)]
    edges.append(span)
    segments = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)]
    minimum_size = max(75, round(span * 0.12))
    if len(segments) < 2 or any(b - a < minimum_size for a, b in segments):
        return []
    return segments


def suggest_panels(source):
    """List normalized candidate boxes. A blank/noisy page returns no suggestions."""
    image = ImageOps.exif_transpose(source).convert("RGB")
    width, height = image.size
    if min(width, height) < 160:
        return []
    # Only split when a complete straight gutter spans the whole current band.
    # Never guess at nested layouts or overlapping characters.
    horizontal = _splits(image, "horizontal")
    if horizontal:
        regions = [(0, a, width, b) for a, b in horizontal]
    else:
        vertical = _splits(image, "vertical")
        regions = [(a, 0, b, height) for a, b in vertical]
    if not regions:
        return []
    boxes = []
    for x1, y1, x2, y2 in regions:
        segment = image.crop((x1, y1, x2, y2))
        secondary_axis = "vertical" if horizontal else "horizontal"
        secondary = _splits(segment, secondary_axis)
        if secondary:
            for a, b in secondary:
                boxes.append(
                    (x1 + a, y1, x1 + b, y2)
                    if secondary_axis == "vertical"
                    else (x1, y1 + a, x2, y1 + b)
                )
        else:
            boxes.append((x1, y1, x2, y2))
    if len(boxes) < 2 or len(boxes) > 12:
        return []
    result = []
    for x1, y1, x2, y2 in boxes:
        if x2 - x1 < 75 or y2 - y1 < 75:
            return []
        result.append(
            {
                "x": round(x1 / width, 6),
                "y": round(y1 / height, 6),
                "width": round((x2 - x1) / width, 6),
                "height": round((y2 - y1) / height, 6),
                "confidence": 0.75,
            }
        )
    return result
