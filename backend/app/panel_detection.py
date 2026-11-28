"""Local, source-preserving panel boundaries from continuous light/dark gutters.

Recursively separates printed panel regions, never editorial camera shots.
Irregular/overlapping artwork without continuous separators still needs review.
"""

import math

from PIL import ImageOps

MIN_GUTTER_LUMINANCE = 150
MAX_PANELS = 24


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


def _source_band(gray, axis, start, end, span, scan, dark):
    """Refine thumbnail coordinates at source resolution, protecting balloon tails."""
    scale = span / scan
    left = max(0, math.floor(start * scale - scale))
    right = min(span, math.ceil(end * scale + scale))
    width, height = gray.size
    safe = []
    for pos in range(left, right):
        box = (0, pos, width, pos + 1) if axis == "horizontal" else (pos, 0, pos + 1, height)
        low, high = gray.crop(box).getextrema()
        safe.append(high <= 75 if dark else low >= MIN_GUTTER_LUMINANCE)
    runs = _bands(safe, max(2, math.ceil(span * 0.001)))
    candidates = [
        (a + left, b + left) for a, b in runs if b + left > start * scale and a + left < end * scale
    ]
    if not candidates:
        return None
    band = max(candidates, key=lambda pair: pair[1] - pair[0])
    if dark:
        # A dark separator has artwork on BOTH sides. JPEG ringing at the edge
        # of a flat dark background is not another printed panel.
        for boundary, direction in [(band[0] - 1, -1), (band[1], 1)]:
            supported = False
            for step in range(8):
                pos = boundary + direction * step
                if not 0 <= pos < span:
                    break
                box = (
                    (0, pos, width, pos + 1) if axis == "horizontal" else (pos, 0, pos + 1, height)
                )
                histogram = gray.crop(box).histogram()
                if sum(histogram[86:]) / (width if axis == "horizontal" else height) >= 0.15:
                    supported = True
                    break
            if not supported:
                return None
    return band


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
    colors = thumb.convert("RGB").load()
    pale, dark = [], []
    for pos in range(scan):
        values = [pixels[n, pos] if axis == "horizontal" else pixels[pos, n] for n in range(across)]
        pale.append(sum(v >= 192 for v in values) / across >= 0.975)
        dark.append(
            sum(v <= 55 for v in values) / across >= 0.995
            and sum(
                max(rgb) <= 55 and max(rgb) - min(rgb) <= 16
                for n in range(across)
                for rgb in [colors[n, pos] if axis == "horizontal" else colors[pos, n]]
            )
            / across
            >= 0.995
        )
    full_gray = image.convert("L")
    for flags, is_dark in [(pale, False), (dark, True)]:
        gutters = _bands(flags, max(2, round(scan * 0.002)))
        candidates = [
            (a, b)
            for a, b in gutters
            if a > scan * 0.025 and b < scan * 0.975 and b - a <= scan * 0.09
        ]
        strips = [
            refined
            for a, b in candidates
            if (refined := _source_band(full_gray, axis, a, b, span, scan, is_dark))
        ]
        if not strips:
            continue
        edges = [0]
        for start, end in strips:
            edges += [start, end]
        edges.append(span)
        segments = [(edges[i], edges[i + 1]) for i in range(0, len(edges) - 1, 2)]
        minimum_size = max(75, round(span * 0.05))
        if len(segments) >= 2 and all(b - a >= minimum_size for a, b in segments):
            return segments
    return []


def suggest_panels(source):
    """Return normalized printed panels in reading order; keep large panels whole."""
    image = ImageOps.exif_transpose(source).convert("RGB")
    width, height = image.size
    if min(width, height) < 160:
        return []

    def partition(box, depth=0):
        x1, y1, x2, y2 = box
        if depth >= 6:
            return [box]
        segment = image.crop(box)
        for axis in ("horizontal", "vertical"):
            splits = _splits(segment, axis)
            if not splits:
                continue
            children = [
                (x1, y1 + a, x2, y1 + b) if axis == "horizontal" else (x1 + a, y1, x1 + b, y2)
                for a, b in splits
            ]
            if any(
                b - a < max(75, width * 0.03) or d - c < max(75, height * 0.03)
                for a, c, b, d in children
            ):
                continue
            return [leaf for child in children for leaf in partition(child, depth + 1)]
        return [box]

    boxes = partition((0, 0, width, height))
    if not 2 <= len(boxes) <= MAX_PANELS:
        return []
    return [
        {
            "x": round(x1 / width, 6),
            "y": round(y1 / height, 6),
            "width": round((x2 - x1) / width, 6),
            "height": round((y2 - y1) / height, 6),
            "confidence": 0.75,
        }
        for x1, y1, x2, y2 in sorted(boxes, key=lambda box: (box[1], box[0]))
    ]
