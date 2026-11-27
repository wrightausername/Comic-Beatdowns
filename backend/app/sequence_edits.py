"""Bounded local sequence instructions and prepared alternatives, using ordinary proposals."""

import copy
import hashlib
import re

from fastapi import HTTPException

from .database import SoundEffect
from .schemas import SceneInput, WorkspaceInput


def sequence_request(text):
    normalized = re.sub(r"\s+", " ", text.casefold()).strip(" .!")
    # Only the declared grammar runs locally. Other prose goes to the existing
    # opt-in writer or copy/paste brief; never silently guess its meaning.
    clauses = re.split(r"\s*(?:,|;|\band\b)\s*", normalized)
    actions = []
    for clause in clauses:
        clause = re.sub(r"^(?:please |also |then )", "", clause).strip()
        if re.fullmatch(
            r"(?:keep|preserve|leave) (?:the )?opening(?: unchanged| alone| as is)?", clause
        ):
            actions.append({"action": "keep", "scope": "opening"})
        elif re.fullmatch(
            r"(?:speed up|tighten|make punchier) (?:the )?(middle|opening|ending)", clause
        ):
            actions.append({"action": "punchier", "scope": clause.split()[-1]})
        elif re.fullmatch(
            r"(?:let (?:the )?final reaction breathe|give (?:the )?ending more (?:time|breathing room)|hold (?:the )?ending longer)",
            clause,
        ):
            actions.append({"action": "breathe", "scope": "ending"})
        elif not clause:
            continue
        else:
            return None
    return actions if actions and any(a["action"] != "keep" for a in actions) else None


def compile_sequence(plan, project, db):
    from .api import project_dict

    if plan["project_id"] != project.id or plan["base_revision"] != project.revision:
        raise HTTPException(409, "The sequence changed. Request a fresh proposal.")
    state = project_dict(project, db, True)
    scenes = state["scenes"]
    fps = project.settings["fps"]
    total = sum(round(s["duration"] * fps) for s in scenes)
    intervals, position = [], 0
    for s in scenes:
        end = position + round(s["duration"] * fps)
        intervals.append((position, end))
        position = end
    actions = plan["actions"]
    kept = {a["scope"] for a in actions if a["action"] == "keep"}
    scope_bounds = {
        "opening": (0, total / 3),
        "middle": (total / 3, total * 2 / 3),
        "ending": (total * 2 / 3, total),
    }

    def protected(s):
        return s["locked"] or s.get("camera_path") or s.get("motion") == "panel_glide"

    changes, replacements = [], {}
    selected = set()
    for action in actions:
        if action["action"] == "keep":
            continue
        low, high = scope_bounds[action["scope"]]
        indices = [
            i
            for i, (a, b) in enumerate(intervals)
            if low <= (a + b) / 2 < high and not protected(scenes[i])
        ]
        indices = [
            i
            for i in indices
            if not any(
                scope_bounds[k][0] <= sum(intervals[i]) / 2 < scope_bounds[k][1] for k in kept
            )
        ]
        if not indices:
            raise ValueError(
                "That sequence contains no editable shots. Keep protected routes/locks, or select a different range."
            )
        selected.update(indices)
        if action["action"] == "punchier":
            for i in indices:
                source = scenes[i]
                frames = round(source["duration"] * fps)
                if frames < fps:
                    continue
                children = []
                split = frames // 2
                for n, (start, end) in enumerate(((0, split), (split, frames))):
                    child = {k: v for k, v in source.items() if k in SceneInput.model_fields}
                    child.update(
                        id=source["id"]
                        if n == 0
                        else hashlib.sha256(
                            f"{project.id}:{project.revision}:{source['id']}:split".encode()
                        ).hexdigest()[:32],
                        duration=(end - start) / fps,
                    )
                    if n:
                        child.update(
                            transition="cut",
                            motion="punch_in",
                            motion_strength=min(0.14, source["motion_strength"] + 0.03),
                        )
                    offset = source.get("sfx_offset", 0) * fps
                    has_sound = source.get("sfx_url") or source.get("sfx_id")
                    if has_sound and start <= offset < end:
                        child.update(sfx_source_id=source["id"], sfx_offset=(offset - start) / fps)
                    else:
                        child.update(sfx_id=None, clear_sfx=True)
                    children.append(child)
                replacements[i] = children
                changes.append(
                    {
                        "shot": i + 1,
                        "field": "sequence",
                        "before": f"One {source['duration']:.2f}s shot",
                        "after": "Two editable framings; recording and sequence endpoints kept",
                    }
                )
        else:
            i = indices[-1]
            neighbor = i - 1
            if neighbor not in indices or protected(scenes[neighbor]):
                raise ValueError(
                    "The ending needs an unlocked preceding shot inside the ending to make room without moving the rest of the video."
                )
            extra = min(
                round(0.8 * fps),
                round(scenes[neighbor]["duration"] * fps) - round(0.5 * fps),
                30 * fps - round(scenes[i]["duration"] * fps),
            )
            if extra <= 0:
                raise ValueError(
                    "There is no spare time in the ending. Adjust its neighboring cut first."
                )
            prior = scenes[neighbor]
            if prior.get("sfx_url"):
                sound = db.get(SoundEffect, prior["sfx_id"]) if prior.get("sfx_id") else None
                if (
                    sound is None
                    or prior["sfx_offset"] + sound.duration > prior["duration"] - extra / fps
                ):
                    raise ValueError(
                        "That hold would cut off an existing sound. Choose another ending cut or adjust its sound first."
                    )
            if scenes[i].get("sfx_url"):
                before_offset = scenes[i]["sfx_offset"]
                scenes[i]["sfx_offset"] += extra / fps
                changes.append(
                    {
                        "shot": i + 1,
                        "field": "sfx_offset",
                        "before": before_offset,
                        "after": scenes[i]["sfx_offset"],
                    }
                )
            for j, delta in ((neighbor, -extra), (i, extra)):
                if j in replacements:
                    raise ValueError(
                        "Ask for a timing change separately from extra cuts in the same sequence."
                    )
                before = scenes[j]["duration"]
                scenes[j]["duration"] = (round(before * fps) + delta) / fps
                changes.append(
                    {
                        "shot": j + 1,
                        "field": "duration",
                        "before": before,
                        "after": scenes[j]["duration"],
                    }
                )
    result = []
    for i, scene in enumerate(scenes):
        result.extend(
            replacements.get(i, [{k: v for k, v in scene.items() if k in SceneInput.model_fields}])
        )
    if not changes:
        raise ValueError("The selected sequence is already too short for more readable cuts.")
    if len(result) > 240:
        raise ValueError("This proposal exceeds the 240-shot limit. Choose a smaller sequence.")
    state.update(scenes=result, base_revision=project.revision, cues=project.caption_cues)
    workspace = WorkspaceInput.model_validate(
        {k: v for k, v in state.items() if k in WorkspaceInput.model_fields}
    )
    return workspace, changes


def alternative_plans(project, scene, scenes):
    """Concrete independent candidates, never speculative character/action changes."""
    base = {"version": 1, "project_id": project.id, "base_revision": project.revision}
    candidates = []
    if scene.locked or scene.camera_path:
        return []
    if scene.framing != "fit" or scene.motion != "hold":
        candidates.append(
            (
                "Wider and still",
                {
                    **base,
                    "edits": [
                        {"scene_id": scene.id, "changes": {"framing": "fit", "motion": "hold"}}
                    ],
                },
            )
        )
    i = scenes.index(scene)
    if len(scenes) > 1:
        neighbor = scenes[i + 1] if i + 1 < len(scenes) else scenes[i - 1]
        if (
            not neighbor.locked
            and not neighbor.camera_path
            and neighbor.motion != "panel_glide"
            and neighbor.duration > 1
            and scene.duration < 29
            and not (scene.sfx_key or neighbor.sfx_key)
        ):
            extra = min(0.6, neighbor.duration - 0.5)
            candidates.append(
                (
                    "Longer hold",
                    {
                        **base,
                        "edits": [
                            {"scene_id": scene.id, "changes": {"duration": scene.duration + extra}}
                        ],
                    },
                )
            )
        if i + 1 < len(scenes) and not scenes[i + 1].locked:
            following = scenes[i + 1]
            if following.panel_id != scene.panel_id or following.source_crop != scene.source_crop:
                candidates.append(
                    (
                        "Next artwork sooner",
                        {
                            **base,
                            "edits": [
                                {
                                    "scene_id": scene.id,
                                    "changes": {
                                        "panel_id": following.panel_id,
                                        "source_crop": copy.deepcopy(following.source_crop),
                                        "framing": "fit",
                                        "motion": "hold",
                                    },
                                }
                            ],
                        },
                    )
                )
    return candidates
