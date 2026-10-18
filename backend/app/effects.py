"""Camera paths and transitions shared by validation and FFmpeg rendering."""

from typing import Literal, get_args

Motion = Literal[
    "hold",
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "drift_up_left",
    "drift_up_right",
    "drift_down_left",
    "drift_down_right",
    "push_left",
    "push_right",
    "push_up",
    "push_down",
    "pull_left",
    "pull_right",
    "punch_in",
    "punch_out",
    "breathe",
]
Easing = Literal["linear", "smooth", "ease_in", "ease_out"]
Transition = Literal[
    "cut",
    "crossfade",
    "fade",
    "dip_white",
    "slide_left",
    "slide_right",
    "slide_up",
    "slide_down",
    "wipe_left",
    "wipe_right",
    "smooth_left",
    "smooth_right",
]
TRANSITIONS = {
    "crossfade": "fade",
    "fade": "fadeblack",
    "dip_white": "fadewhite",
    "slide_left": "slideleft",
    "slide_right": "slideright",
    "slide_up": "slideup",
    "slide_down": "slidedown",
    "wipe_left": "wipeleft",
    "wipe_right": "wiperight",
    "smooth_left": "smoothleft",
    "smooth_right": "smoothright",
}
MOTIONS = get_args(Motion)


def camera_expressions(scene, frames):
    """Return zoom and normalized crop positions for FFmpeg's zoompan filter."""
    t = f"(on/{max(1, frames - 1)})"
    motion = scene["motion"]
    if motion.startswith("punch_"):
        t = f"min(1,{t}/0.18)"
    easing = scene.get("easing", "linear")
    progress = {
        "linear": t,
        "smooth": f"({t}*{t}*(3-2*{t}))",
        "ease_in": f"({t}*{t})",
        "ease_out": f"(1-(1-{t})*(1-{t}))",
    }[easing]
    strength = scene.get("motion_strength", 0.1)
    fx, fy = scene.get("focus_x", 0.5), scene.get("focus_y", 0.5)
    zoom, x, y = "1", str(fx), str(fy)
    if motion in {"zoom_in", "punch_in"} or motion.startswith("push_"):
        zoom = f"(1+{strength}*{progress})"
    elif motion in {"zoom_out", "punch_out"} or motion.startswith("pull_"):
        zoom = f"(1+{strength}*(1-{progress}))"
    elif motion == "breathe":
        zoom = f"(1+{strength}*sin(PI*{progress}))"
    elif motion.startswith(("pan_", "drift_")):
        zoom = str(1 + strength)
    if motion.endswith("left"):
        x = f"({min(1, fx + 0.5)}+({max(0, fx - 0.5)}-{min(1, fx + 0.5)})*{progress})"
    elif motion.endswith("right"):
        x = f"({max(0, fx - 0.5)}+({min(1, fx + 0.5)}-{max(0, fx - 0.5)})*{progress})"
    if "_up" in motion:
        y = f"({min(1, fy + 0.5)}+({max(0, fy - 0.5)}-{min(1, fy + 0.5)})*{progress})"
    elif "_down" in motion:
        y = f"({max(0, fy - 0.5)}+({min(1, fy + 0.5)}-{max(0, fy - 0.5)})*{progress})"
    return zoom, f"(iw-iw/zoom)*{x}", f"(ih-ih/zoom)*{y}"


def incoming_transition(scene, previous, settings):
    """Clamp blends to half of either scene; preserve all logical scene durations."""
    effect = scene.get("transition") or settings.get("transition", "fade")
    if previous is None or effect == "cut":
        return "cut", 0
    fps = settings["fps"]
    requested = scene.get("transition_duration")
    if requested is None:
        requested = settings.get("transition_duration", 0.25)
    frames = max(1, int(requested * fps + 0.5))
    cap = max(1, int(min(previous["duration"], scene["duration"]) * fps / 2))
    return effect, min(frames, cap)
