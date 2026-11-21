"""Camera path focal-point geometry shared by the narration-led FFmpeg renderer.

Waypoints are in normalized coordinates relative to the selected source crop,
not display pixels. A fitted image may be letterboxed: translate each clicked
artwork point to the closest safe viewport origin so video never shows gutters
outside the source just because of a diagonal camera path.
"""

from math import hypot

TARGET_RATIO = 9 / 16
MAX_ZOOM = 8.0


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def path_zoom(aspect, multiplier=1.4):
    base = max(1.0, aspect / TARGET_RATIO, TARGET_RATIO / aspect)
    return round(min(MAX_ZOOM, base * clamp(multiplier, 1, 2)), 6)


def focal_to_viewport(point, aspect, zoom):
    """Map a desired focal point on the source art into zoompan travel [0,1]."""
    if aspect >= TARGET_RATIO:
        artwork_width, artwork_height = 1.0, TARGET_RATIO / aspect
    else:
        artwork_width, artwork_height = aspect / TARGET_RATIO, 1.0
    viewport = 1 / zoom

    def axis(value, content_length):
        offset = (1 - content_length) / 2
        low, high = offset, offset + content_length - viewport
        if high < low:
            # Extremely elongated image reaches the safety zoom cap.
            return 0.5
        center = offset + clamp(value) * content_length
        left = clamp(center - viewport / 2, low, high)
        return round(clamp(left / max(1e-9, 1 - viewport)), 6)

    return axis(point["x"], artwork_width), axis(point["y"], artwork_height)


def route_segments(points, aspect, zoom):
    """Return (path bounds, normalized elapsed-distance breaks)."""
    viewports = [focal_to_viewport(p, aspect, zoom) for p in points]
    distances = [
        max(0.000001, hypot(b["x"] - a["x"], b["y"] - a["y"])) for a, b in zip(points, points[1:])
    ]
    total = sum(distances)
    breaks = [0.0]
    for d in distances:
        breaks.append(breaks[-1] + d / total)
    breaks[-1] = 1.0
    return viewports, breaks


def path_coordinate_expression(values, breaks, progress):
    """Piecewise linear movement through every numbered waypoint."""
    if len(values) < 2:
        return "0.5"
    expr = str(values[-1])
    for i in reversed(range(len(values) - 1)):
        width = max(0.000001, breaks[i + 1] - breaks[i])
        segment = (
            f"({values[i]}+({values[i + 1]}-{values[i]})"
            f"*(({progress})-{round(breaks[i], 7)})/{round(width, 7)})"
        )
        expr = f"if(lt({progress},{round(breaks[i + 1], 7)}),{segment},{expr})"
    return expr
