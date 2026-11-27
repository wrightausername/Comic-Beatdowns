"""Structure-aware, narration-aligned adaptation of an inspectable style recipe."""

import math
import subprocess
from uuid import UUID, uuid5

from fastapi import HTTPException

from .api import project_dict
from .audio import analyze_audio
from .reference_style import StyleOptions, allocate_frames, normalized_recipe, style_for
from .renderer import scene_frames
from .schemas import SceneInput, WorkspaceInput

MAJOR_TRANSITIONS = {
    "dip_white",
    "slide_left",
    "slide_right",
    "slide_up",
    "slide_down",
    "wipe_left",
    "wipe_right",
    "smooth_left",
    "smooth_right",
}
MAJOR_MOTIONS = {"impact_shake", "punch_in", "punch_out"}


def narration_anchors(project, state):
    fps, start = project.settings["fps"], project.settings.get("narration_start", 0)
    available = (
        project.narration_duration if project.narration_duration is not None else start + 180
    )
    end = min(project.settings.get("narration_end") or available, available)
    frames, sources, notes = set(), [], []
    for cue in project.caption_cues:
        for value in (cue["start"], cue["end"]):
            if start < value < end:
                frames.add(round((value - start) * fps))
    if frames:
        sources.append("imported subtitle boundaries")
    if project.narration_key and state.storage.path(project.narration_key).is_file():
        try:
            signal = analyze_audio(state.storage.path(project.narration_key), state.settings)
            pause_count = 0
            for left, right in signal["pauses"]:
                # Do not call a long stretch of silence a precise word/beat alignment.
                if 0.12 <= right - left <= 1.5 and start < (left + right) / 2 < end:
                    frames.add(round(((left + right) / 2 - start) * fps))
                    pause_count += 1
            if pause_count:
                sources.append("locally measured narration pauses")
        except (ValueError, OSError, subprocess.TimeoutExpired):
            notes.append(
                "Narration pause analysis was unavailable; available subtitle boundaries are still used."
            )
    return {"frames": sorted(frames), "sources": sources, "notes": notes}


def snapped_lengths(lengths, minimum, maximum, anchors):
    total, boundaries, ideal, snapped = sum(lengths), [0], 0, 0
    for i, length in enumerate(lengths[:-1]):
        ideal += length
        remaining = len(lengths) - i - 1
        lo, hi = (
            max(boundaries[-1] + minimum, total - remaining * maximum),
            min(boundaries[-1] + maximum, total - remaining * minimum),
        )
        target = min(hi, max(lo, ideal))
        nearby = [a for a, window in anchors if lo <= a <= hi and abs(a - ideal) <= window]
        if nearby:
            target = min(nearby, key=lambda n: (abs(n - ideal), n))
            snapped += target != ideal
        boundaries.append(target)
    boundaries.append(total)
    return [b - a for a, b in zip(boundaries, boundaries[1:])], snapped


def recipe_positions(beats):
    total, cursor, positions = sum(b.seconds for b in beats), 0, []
    for beat in beats:
        positions.append((cursor / total, (cursor + beat.seconds) / total, beat))
        cursor += beat.seconds
    return positions


def choose_beat(positions, progress, purpose="custom"):
    matches = [p for p in positions if p[2].purpose == purpose] if purpose != "custom" else []
    if matches:
        return min(matches, key=lambda p: abs((p[0] + p[1]) / 2 - progress))[2]
    return next(
        (beat for left, right, beat in positions if left <= progress < right), positions[-1][2]
    )


def compile_smart_style(plan, project, db):
    if plan["project_id"] != project.id or plan["base_revision"] != project.revision:
        raise HTTPException(
            409, "This style proposal is stale. Propose against the saved video again."
        )
    style = style_for(db, plan["reference_id"])
    if style.revision != plan["reference_revision"]:
        raise HTTPException(409, "The recipe changed. Preview a fresh style proposal.")
    options, recipe = (
        StyleOptions.model_validate(plan["options"]),
        normalized_recipe(style),
    )
    beats = [beat for beat in recipe.beats if beat.enabled]
    if not beats:
        raise ValueError("Enable at least one style beat")
    state = project_dict(project, db, True)
    old, fps = state["scenes"], project.settings["fps"]
    first, last = (
        options.first_shot,
        options.last_shot if options.last_shot is not None else len(old) - 1,
    )
    if not old or not 0 <= first <= last < len(old):
        raise ValueError("Choose a valid shot range")
    if not options.intensity or not (options.pacing or options.transitions or options.camera):
        raise ValueError("Choose some style intensity and at least one part to transfer")
    originals = [
        SceneInput.model_validate({k: v for k, v in s.items() if k in SceneInput.model_fields})
        for s in old
    ]
    starts, cursor = [], 0
    for source in old:
        starts.append(cursor)
        cursor += scene_frames(source["duration"], fps)
    total_frames = cursor
    selected_start = starts[first]
    selected_end = starts[last] + scene_frames(old[last]["duration"], fps)
    selected_frames = selected_end - selected_start
    positions = recipe_positions(beats)
    reference_indices = {id(beat): index + 1 for index, beat in enumerate(recipe.beats)}
    warnings = list(plan.get("alignment", {}).get("notes", []))
    stats = {
        "aligned_cuts": 0,
        "protected_shots": 0,
        "consolidated_shots": 0,
        "unreviewed_effects_skipped": 0,
        "flash_effects_skipped": 0,
        "budgeted_effects_skipped": 0,
        "readability_guards": 0,
        "purpose_matches": 0,
    }

    def protected(s):
        return s["locked"] or bool(s["camera_path"]) or s["motion"] == "panel_glide"

    def fixed_time(s):
        return (
            protected(s)
            or bool(s["caption"].strip() or s["sfx_url"] or s["sfx_id"])
            or s["beat"] == "read"
        )

    stats["preserved_timed_holds"] = sum(
        fixed_time(s) and not protected(s) for s in old[first : last + 1]
    )

    def can_merge(left, right):
        fields = (
            "panel_id",
            "source_panel_ref",
            "source_crop",
            "framing",
            "focus_x",
            "focus_y",
            "beat",
        )
        if not options.camera:
            fields += ("motion", "motion_strength", "easing")
        return all(left[k] == right[k] for k in fields) and right["note"] in ("", left["note"])

    output, owners, capacity, i = [], {s["id"]: k for k, s in enumerate(old)}, 240 - len(old), 0
    while i < len(old):
        if not options.pacing or not first <= i <= last or fixed_time(old[i]):
            output.append(originals[i].model_copy(deep=True))
            i += 1
            continue
        j = i + 1
        while j <= last and not fixed_time(old[j]):
            j += 1
        group_frames = sum(scene_frames(s["duration"], fps) for s in old[i:j])
        lo = (starts[i] - selected_start) / selected_frames
        hi = (starts[i] + group_frames - selected_start) / selected_frames
        local_beats = (
            [b for left, right, b in positions if right > lo and left < hi]
            if options.mapping == "structure"
            else beats
        )
        local_beats = local_beats or [choose_beat(positions, (lo + hi) / 2)]
        current_average = group_frames / (fps * (j - i))
        reference_average = sum(b.seconds for b in local_beats) / len(local_beats) / options.tempo
        average = current_average * (1 - options.intensity) + reference_average * options.intensity
        units = []
        for n in range(i, j):
            if units and average > current_average * 1.15 and can_merge(old[units[-1][0]], old[n]):
                units[-1].append(n)
            else:
                units.append([n])
        consolidated = j - i - len(units)
        stats["consolidated_shots"] += consolidated
        capacity += consolidated
        requested_minimum = math.ceil(options.minimum_hold * fps)
        minimum = max(math.ceil(0.25 * fps), min(requested_minimum, group_frames // len(units)))
        if minimum < requested_minimum:
            warnings.append(
                "The selected runtime is too short for the requested minimum hold on every required artwork shot; source order and runtime were preserved."
            )
        desired_count = max(
            len(units),
            math.ceil(group_frames / (30 * fps)),
            math.ceil(group_frames / fps / average),
        )
        count = min(group_frames // minimum, len(units) + capacity, desired_count)
        if count < desired_count:
            warnings.append(
                "Shot-count or readable-hold limits reduced the reference's requested cut frequency."
            )
        if reference_average > current_average and len(units) == j - i and count == len(units):
            warnings.append(
                "Some slow-reference holds were shortened to preserve every distinct piece of your artwork."
            )
        capacity -= count - len(units)
        copies = [1] * len(units)
        for _ in range(count - len(units)):
            unit = max(
                range(len(units)),
                key=lambda n: sum(old[k]["duration"] for k in units[n]) / (copies[n] + 1),
            )
            copies[unit] += 1
        weights = []
        for n in range(count):
            beat = (
                local_beats[min(len(local_beats) - 1, n * len(local_beats) // count)]
                if options.mapping == "structure"
                else beats[n % len(beats)]
            )
            weights.append(
                current_average * (1 - options.intensity) + beat.seconds * options.intensity
            )
        lengths = allocate_frames(group_frames, weights, minimum, 30 * fps)
        if options.align_narration:
            anchors = [
                (a - starts[i], round(0.22 * fps))
                for a in plan.get("alignment", {}).get("frames", [])
            ]
            lengths, snapped = snapped_lengths(lengths, minimum, 30 * fps, anchors)
            stats["aligned_cuts"] += snapped
        offset = 0
        for unit, count_for_source in zip(units, copies):
            owner = unit[0]
            for copy in range(count_for_source):
                shot = originals[owner].model_copy(deep=True)
                shot.duration = lengths[offset] / fps
                if copy:
                    shot.id = uuid5(UUID(plan["seed"]), f"{shot.id}:{copy}").hex
                    owners[shot.id] = owner
                    (
                        shot.caption,
                        shot.sfx_id,
                        shot.sfx_source_id,
                        shot.sfx_offset,
                        shot.clear_sfx,
                    ) = "", None, None, 0, True
                output.append(shot)
                offset += 1
        i = j
    assignments, cursor, loop_index = [], 0, 0
    for position, shot in enumerate(output):
        source = old[owners[shot.id]]
        if first <= owners[shot.id] <= last:
            if protected(source):
                stats["protected_shots"] += 1
            else:
                progress = (cursor - selected_start) / selected_frames
                beat = (
                    choose_beat(positions, progress, source["beat"])
                    if options.mapping == "structure"
                    else beats[loop_index % len(beats)]
                )
                loop_index += 1
                if beat.purpose != "any" and beat.purpose == source["beat"]:
                    stats["purpose_matches"] += 1
                transition_apply = options.transitions and (
                    beat.transition_reviewed or options.use_suggestions
                )
                camera_apply = options.camera and (beat.motion_reviewed or options.use_suggestions)
                transition = beat.transition if transition_apply else shot.transition
                motion = beat.motion if camera_apply else shot.motion
                if (
                    options.transitions
                    and not beat.transition_reviewed
                    and not options.use_suggestions
                ):
                    transition = shot.transition
                    stats["unreviewed_effects_skipped"] += 1
                if options.camera and not beat.motion_reviewed and not options.use_suggestions:
                    motion = shot.motion
                    stats["unreviewed_effects_skipped"] += 1
                if transition_apply and transition == "dip_white" and not options.allow_flashes:
                    transition = "cut"
                    stats["flash_effects_skipped"] += 1
                if source["beat"] == "read" or source["caption"].strip():
                    guarded = False
                    if camera_apply and motion in MAJOR_MOTIONS:
                        motion = shot.motion if shot.motion not in MAJOR_MOTIONS else "hold"
                        guarded = True
                    if transition_apply and transition in MAJOR_TRANSITIONS:
                        transition, guarded = "cut", True
                    stats["readability_guards"] += guarded
                major = (transition_apply and transition in MAJOR_TRANSITIONS) or (
                    camera_apply and motion in MAJOR_MOTIONS
                )
                priority = (4 if source["beat"] in {"hit", "reveal"} else 0) + (
                    3 if beat.purpose == source["beat"] else 0
                )
                assignments.append(
                    {
                        "shot": shot,
                        "source": source,
                        "beat": beat,
                        "frame": cursor,
                        "motion": motion,
                        "transition": transition,
                        "major": major,
                        "priority": priority,
                        "transition_apply": transition_apply,
                        "camera_apply": camera_apply,
                        "position": position + 1,
                        "reference_index": reference_indices[id(beat)],
                    }
                )
        cursor += scene_frames(shot.duration, fps)
    effect_times = []
    rate = options.effects_per_minute * options.intensity
    interval = math.ceil(60 * fps / rate) if rate else total_frames + 1
    for item in sorted(
        (a for a in assignments if a["major"]), key=lambda a: (-a["priority"], a["frame"])
    ):
        if rate and all(abs(item["frame"] - stamp) >= interval for stamp in effect_times):
            effect_times.append(item["frame"])
            item["major_allowed"] = True
        else:
            stats["budgeted_effects_skipped"] += 1
    for item in assignments:
        shot, beat = item["shot"], item["beat"]
        transition, motion = item["transition"], item["motion"]
        if item["major"] and not item.get("major_allowed"):
            if item["transition_apply"] and transition in MAJOR_TRANSITIONS:
                transition = "cut"
            if item["camera_apply"] and motion in MAJOR_MOTIONS:
                motion = shot.motion if shot.motion not in MAJOR_MOTIONS else "hold"
        if item["transition_apply"]:
            baseline = (
                (shot.transition_duration or project.settings.get("transition_duration", 0.25))
                if shot.transition == transition
                else 0.08
            )
            target = beat.transition_duration or recipe.transition_duration
            shot.transition = transition
            if transition != "cut":
                shot.transition_duration = round(
                    baseline * (1 - options.intensity) + target * options.intensity, 4
                )
        if item["camera_apply"]:
            baseline = shot.motion_strength if shot.motion == motion else 0.02
            shot.motion = motion
            if motion != "hold":
                shot.motion_strength = round(
                    baseline * (1 - options.intensity)
                    + (beat.motion_strength or recipe.motion_strength) * options.intensity,
                    4,
                )
                shot.easing = beat.easing if beat.easing else "smooth"
    changes, cursor = [], 0
    if len(output) != len(old):
        changes.append({"field": "Timeline shots", "before": len(old), "after": len(output)})
    old_by_id = {s["id"]: s for s in old}
    for position, shot in enumerate(output):
        source = old_by_id.get(shot.id)
        if source and protected(source):
            if (
                shot.model_dump() != originals[owners[shot.id]].model_dump()
                or cursor != starts[owners[shot.id]]
            ):
                raise ValueError("This adaptation would alter a locked shot or custom route")
        if source:
            for field in (
                "duration",
                "transition",
                "transition_duration",
                "motion",
                "motion_strength",
                "easing",
            ):
                if source[field] != getattr(shot, field):
                    changes.append(
                        {
                            "shot": position + 1,
                            "field": field,
                            "before": source[field],
                            "after": getattr(shot, field),
                        }
                    )
        else:
            changes.append(
                {
                    "shot": position + 1,
                    "field": "Added editable shot",
                    "before": None,
                    "after": {
                        "source_shot": owners[shot.id] + 1,
                        "duration": shot.duration,
                        "motion": shot.motion,
                        "transition": shot.transition,
                    },
                }
            )
        cursor += scene_frames(shot.duration, fps)
    if cursor != total_frames:
        raise ValueError("Style adaptation must preserve the exact recording timeline")
    if not changes:
        raise ValueError(
            "No changes remain after protecting your shots. Adjust the recipe or selection."
        )
    report = {
        "summary": [
            "Mapped opening, middle and ending positions"
            if options.mapping == "structure"
            else "Repeated the selected beat pattern",
            f"Moved {stats['aligned_cuts']} cuts to nearby narration/subtitle boundaries",
            f"Preserved {stats['protected_shots']} locked or routed shots",
            f"Kept {stats['preserved_timed_holds']} caption, sound or reading holds at their original times",
            f"Applied {len(effect_times)} major effect moments within your intensity/frequency limit",
        ],
        "counts": stats,
        "warnings": list(dict.fromkeys(warnings)),
        "alignment_sources": plan.get("alignment", {}).get("sources", []),
        "unsupported_effects": recipe.unsupported_effects,
        "trace": [
            {
                "shot": item["position"],
                "source_shot": owners[item["shot"].id] + 1,
                "reference_beat": item["reference_index"],
                "reference_time": item["beat"].source_start,
                "purpose": item["beat"].purpose,
                "evidence": item["beat"].evidence[:220],
                "reason": (
                    "Matched story-beat tags"
                    if options.mapping == "structure"
                    and item["beat"].purpose == item["source"]["beat"]
                    else "Matched reference position"
                    if options.mapping == "structure"
                    else "Repeated beat pattern"
                )
                + (
                    "; unreviewed suggestions omitted"
                    if not item["transition_apply"]
                    and options.transitions
                    or not item["camera_apply"]
                    and options.camera
                    else ""
                )
                + (
                    "; major effect limited by frequency setting"
                    if item["major"] and not item.get("major_allowed")
                    else ""
                ),
            }
            for item in assignments
        ],
    }
    changes.insert(0, {"field": "Style adaptation", "before": None, "after": report})
    workspace = WorkspaceInput(
        base_revision=project.revision,
        title=project.title,
        idea=project.idea,
        script=project.script,
        settings=project.settings,
        workflow=project.workflow,
        cues=project.caption_cues,
        scenes=output,
    )
    return workspace, changes
