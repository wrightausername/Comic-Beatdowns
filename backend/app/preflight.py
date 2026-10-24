"""Deterministic, explainable review warnings. No claim of understanding artwork."""

from collections import Counter


def check_episode(project):
    scenes = project.get("scenes") or []
    settings = project.get("settings") or {}
    fps = settings.get("fps", 24)
    findings = []

    def add(code, message, severity="warning", seconds=None, scene_index=None):
        findings.append(
            {
                "code": code,
                "message": message,
                "severity": severity,
                "seconds": seconds,
                "scene_index": scene_index,
            }
        )

    if not project.get("narration_url"):
        add("voice_missing", "Narration is missing. Add a voice recording.", "critical")
    if not scenes:
        add("scenes_missing", "There are no shots. Add or generate a timeline.", "critical")
        return findings

    def frames(duration):
        return max(1, int(duration * fps + 0.5))
    length = sum(frames(scene["duration"]) for scene in scenes) / fps
    narration = project.get("narration_duration") or 0
    start = settings.get("narration_start") or 0
    end = settings.get("narration_end")
    available_voice = max(0, min(end if end is not None else narration, narration) - start)
    if narration and abs(length - available_voice) > 0.3:
        add(
            "duration_mismatch",
            f"Timeline is {length:.1f}s but selected narration is {available_voice:.1f}s.",
            "critical",
        )
    if not project.get("script", "").strip():
        add("script_missing", "No reviewed script is attached to this episode.")
    if not project.get("caption_cues") and settings.get("captions"):
        add("captions_missing", "Captions are enabled but no timed subtitle cues exist.")
    cursor = 0.0
    repeated = Counter(scene["panel_id"] for scene in scenes)
    for index, scene in enumerate(scenes):
        duration = frames(scene["duration"]) / fps
        panel = scene.get("panel") or {}
        label = panel.get("title") or f"shot {index + 1}"
        if duration < 0.45:
            add(
                "flash_cut",
                f"Shot {index + 1} ({label}) is only {duration:.2f}s. Check readability.",
                seconds=cursor,
                scene_index=index,
            )
        if duration > 6 and scene.get("motion") == "hold":
            add(
                "long_static",
                f"Shot {index + 1} holds the same artwork for {duration:.1f}s.",
                seconds=cursor,
                scene_index=index,
            )
        if scene.get("framing") != "fit":
            width, height = panel.get("width") or 0, panel.get("height") or 0
            if width and height:
                # Actual 9:16 crop before output upscaling.
                cropped_width = min(width, height * 9 / 16)
                cropped_height = min(height, width * 16 / 9)
                # Motion can introduce additional zoom beyond a static crop.
                strength = scene.get("motion_strength") or 0
                zoom_factor = 1 + strength if scene.get("motion") != "hold" else 1
                if cropped_width / zoom_factor < 540 or cropped_height / zoom_factor < 960:
                    add(
                        "low_resolution",
                        f"Shot {index + 1} magnifies a small part of {label}; check sharpness.",
                        seconds=cursor,
                        scene_index=index,
                    )
        if repeated[scene["panel_id"]] >= 4 and duration >= 2:
            add(
                "repeated_panel",
                f"Shot {index + 1} reuses the same panel repeatedly. Check variety.",
                seconds=cursor,
                scene_index=index,
            )
        cursor += duration
    if length >= 20 and scenes[0]["panel_id"] != scenes[-1]["panel_id"]:
        add(
            "loop_review",
            "Opening and closing shots use different artwork. Review the playback loop.",
            seconds=max(0, length - 3),
        )
    return findings
