"""Deterministic first cuts. Pacing and excerpt length are independent choices."""

import math

from .database import uid


def audio_range(settings, duration):
    start = settings.get("narration_start", 0)
    end = min(settings.get("narration_end") or duration, duration)
    if end - start < 0.25:
        raise ValueError("Select at least 0.25 seconds of available narration")
    return start, end


def auto_edit(scenes, settings, duration, options, pauses=()):
    if not scenes:
        raise ValueError("Add panels before creating an automatic edit")
    if any(getattr(scene, "locked", False) for scene in scenes):
        # Locked shots retain all their settings; distribute remaining time only
        # across existing unlocked shots instead of replacing their identities.
        start, end = audio_range(settings, duration)
        if options.length == "short":
            end = min(end, start + 30)
        fps = settings["fps"]
        total = math.ceil((end - start) * fps - 1e-6)
        fixed = sum(round(s.duration * fps) for s in scenes if s.locked)
        unlocked = [s for s in scenes if not s.locked]
        remaining = total - fixed
        minimum = math.ceil(0.25 * fps)
        if (
            (not unlocked and remaining)
            or remaining < len(unlocked) * minimum
            or remaining > len(unlocked) * 30 * fps
        ):
            raise ValueError(
                "Locked scenes leave too little or too much time. Unlock a scene or change the narration range."
            )
        result, used_frames = [], 0
        for scene in scenes:
            values = {
                key: getattr(scene, key, default)
                for key, default in {
                    "id": None,
                    "panel_id": "",
                    "duration": 5,
                    "motion": "hold",
                    "motion_strength": 0.1,
                    "easing": "smooth",
                    "focus_x": 0.5,
                    "focus_y": 0.5,
                    "transition": None,
                    "transition_duration": None,
                    "caption": "",
                    "locked": False,
                    "note": "",
                    "beat": "custom",
                    "sfx_id": None,
                    "sfx_offset": 0,
                    "framing": "fill",
                }.items()
            }
            if not scene.locked:
                i = unlocked.index(scene)
                frames = remaining // len(unlocked) + (i < remaining % len(unlocked))
                used_frames += frames
                values.update(
                    duration=frames / fps,
                    motion=("punch_in" if i % 2 == 0 else "pan_right")
                    if options.pace == "fast"
                    else "zoom_in",
                    motion_strength=0.22 if options.pace == "fast" else 0.08,
                    easing="ease_out" if options.pace == "fast" else "smooth",
                    transition="cut" if options.pace == "fast" else "crossfade",
                )
            result.append(values)
        return {
            "scenes": result,
            "settings": {
                **settings,
                "edit_pace": options.pace,
                "narration_start": start,
                "narration_end": end,
            },
            "duration": total / fps,
        }
    # Rebuilding a fast cut as a slow cut should consolidate its reframings.
    groups = []
    for scene in scenes:
        if (
            groups
            and groups[-1].panel_id == scene.panel_id
            and not scene.caption.strip()
            and not scene.sfx_key
        ):
            continue
        groups.append(scene)
    scenes = groups
    # The buttons are explicit: full recording, or its first thirty seconds.
    start, end = 0, duration
    if options.length == "short":
        limit = min(start + 30, end)
        candidates = [a for a, _ in pauses if limit - 2 <= a <= limit and a - start >= 0.25]
        end = max(candidates) if candidates else limit
    fps = settings["fps"]
    frames = math.ceil((end - start) * fps - 1e-6)
    end = min(duration, start + frames / fps)
    shot = options.shot_seconds or (1.25 if options.pace == "fast" else 5)
    count = min(240, max(len(scenes), math.ceil(frames / fps / shot)))
    if frames < count * math.ceil(0.25 * fps):
        raise ValueError(
            "The narration excerpt is too short for all selected scenes; remove some scenes first"
        )
    # Keep each panel's place in the story, adding consecutive reframings.
    base, extra = divmod(count, len(scenes))
    sources = [scene for i, scene in enumerate(scenes) for _ in range(base + (i < extra))]
    weights = [
        ([0.75, 1.1, 1.4, 0.9][i % 4] if options.pace == "fast" else 1) for i in range(count)
    ]
    total_weight = sum(weights)
    boundaries, cumulative = [0], 0
    minimum = math.ceil(0.25 * fps)
    for i, weight in enumerate(weights[:-1]):
        cumulative += weight
        ideal = frames * cumulative / total_weight
        near = [
            round(((a + b) / 2 - start) * fps)
            for a, b in pauses
            if abs((a + b) / 2 - start - ideal / fps) < 0.18
        ]
        proposed = min(near, key=lambda n: abs(n - ideal)) if near else round(ideal)
        boundaries.append(
            max(boundaries[-1] + minimum, min(proposed, frames - minimum * (count - i - 1)))
        )
    boundaries.append(frames)
    result, used = [], set()
    fast_moves = ["punch_in", "pan_right", "push_left", "punch_out", "pan_up", "push_right"]
    slow_moves = ["zoom_in", "pan_left", "zoom_out", "drift_up_right", "breathe"]
    for i, source in enumerate(sources):
        keep = source.id not in used
        used.add(source.id)
        values = {
            key: getattr(source, key) for key in ("panel_id", "focus_x", "focus_y", "caption")
        }
        result.append(
            {
                **values,
                "id": source.id if keep else uid(),
                "locked": False,
                "framing": getattr(source, "framing", "fill"),
                "note": getattr(source, "note", "") if keep else "",
                "beat": getattr(source, "beat", "custom"),
                "sfx_id": getattr(source, "sfx_id", None) if keep else None,
                "sfx_offset": getattr(source, "sfx_offset", 0) if keep else 0,
                "caption": source.caption if keep else "",
                "duration": (boundaries[i + 1] - boundaries[i]) / fps,
                "motion": (fast_moves if options.pace == "fast" else slow_moves)[
                    i % (6 if options.pace == "fast" else 5)
                ],
                "motion_strength": (0.18 + (i % 3) * 0.04) if options.pace == "fast" else 0.08,
                "easing": "ease_out" if options.pace == "fast" else "smooth",
                "transition": "slide_left"
                if options.pace == "fast" and i % 6 == 5
                else ("cut" if options.pace == "fast" else "crossfade"),
                "transition_duration": 0.12 if options.pace == "fast" else 0.25,
            }
        )
    updated = {
        **settings,
        "edit_pace": options.pace,
        "narration_start": start,
        "narration_end": end,
    }
    return {"scenes": result, "settings": updated, "duration": frames / fps}
