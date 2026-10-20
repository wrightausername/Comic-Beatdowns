"""Local, explainable editing suggestions. No external service or image downloads."""

import copy
import json
import math
import random
import re
import wave
from array import array

from fastapi import HTTPException

from .autoedit import audio_range, auto_edit
from .database import Panel, SoundEffect, uid
from .renderer import scene_frames, timeline_duration
from .schemas import AutoEditInput, SceneInput

BEATS = {
    "hit": {
        "motion": "punch_in",
        "motion_strength": 0.26,
        "easing": "ease_out",
        "transition": "cut",
    },
    "reveal": {
        "motion": "zoom_out",
        "motion_strength": 0.22,
        "easing": "ease_out",
        "transition": "cut",
    },
    "reaction": {
        "motion": "punch_out",
        "motion_strength": 0.2,
        "easing": "ease_out",
        "transition": "cut",
    },
    "read": {"motion": "hold", "motion_strength": 0.02, "easing": "linear", "transition": "cut"},
}
STOP = set(
    "the a an and of to in is it he she they this that with for on but his her was at as you your then".split()
)
IMPACTS = set(
    "hit hits punch punches punched smash smashes slammed slam kick kicks knockout knocked impact boom".split()
)
REVEALS = set("reveal reveals suddenly actually surprise turns except".split())
REACTIONS = set("seriously really ridiculous embarrassing joke bruh wait what".split())


def tokens(text):
    return set(re.findall(r"[a-z0-9]+", text.lower())) - STOP


def beat_for(text):
    words = tokens(text)
    return (
        "hit"
        if words & IMPACTS
        else "reveal"
        if words & REVEALS
        else "reaction"
        if words & REACTIONS
        else "custom"
    )


def validate_workflow(value, db):
    if len(json.dumps(value)) > 128_000:
        raise HTTPException(422, "Project notes and storyboard are too large")
    allowed = {"panel_ids", "storyboard", "notes", "sound_choices", "emotion_overrides"}
    if set(value) - allowed:
        raise HTTPException(422, "Unknown workflow fields")
    for key in ("panel_ids", "storyboard", "notes"):
        if key in value and (not isinstance(value[key], list) or len(value[key]) > 600):
            raise HTTPException(422, "Too many workflow entries")
    overrides = value.get("emotion_overrides", {})
    if (
        not isinstance(overrides, dict)
        or len(overrides) > 200
        or any(
            not isinstance(key, str)
            or not re.fullmatch(r"\\d+:\\d+:(?:disbelief|frustrated|shouting|sarcastic|deadpan|whisper|escalating|pause|emphasis)", key)
            or isinstance(seconds, bool)
            or not isinstance(seconds, (float, int))
            or not math.isfinite(seconds)
            or not 0 <= seconds <= 180
            for key, seconds in overrides.items()
        )
    ):
        raise HTTPException(422, "Emotion cue timing needs valid seconds between 0 and 180")
    choices = value.get("sound_choices", {})
    if (
        not isinstance(choices, dict)
        or set(choices) - {"impact", "whoosh", "reaction"}
        or any(
            not isinstance(sound_id, str) or not db.get(SoundEffect, sound_id)
            for sound_id in choices.values()
            if sound_id
        )
    ):
        raise HTTPException(422, "Choose valid favorite sounds")
    ids = value.get("panel_ids", [])
    if any(not isinstance(i, str) or not db.get(Panel, i) for i in ids):
        raise HTTPException(422, "A project panel is missing")
    for card in value.get("storyboard", []):
        if not isinstance(card, dict) or set(card) - {"start", "end", "text", "panel_id", "beat"}:
            raise HTTPException(422, "Invalid storyboard card")
        try:
            start, end = float(card["start"]), float(card["end"])
            if not math.isfinite(start + end) or not 0 <= start < end <= 180:
                raise ValueError
            if len(card["text"]) > 300 or not isinstance(card["text"], str):
                raise ValueError
            if not db.get(Panel, card["panel_id"]) or card.get("beat", "custom") not in {
                "custom",
                *BEATS,
            }:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise HTTPException(
                422, "Storyboard cards need a panel, text, and valid times"
            ) from None
    for note in value.get("notes", []):
        try:
            if not isinstance(note, dict) or set(note) - {"id", "time", "text", "done"}:
                raise ValueError
            if not isinstance(note["text"], str) or not 1 <= len(note["text"]) <= 1000:
                raise ValueError
            if not isinstance(note.get("id"), str) or not isinstance(note.get("done", False), bool):
                raise ValueError
            if not math.isfinite(float(note["time"])) or not 0 <= float(note["time"]) <= 180:
                raise ValueError
        except (ValueError, TypeError, KeyError):
            raise HTTPException(422, "Notes need text and a valid timeline position") from None
    return copy.deepcopy(value)


def storyboard(project, panels):
    start, end = audio_range(project.settings, project.narration_duration or 90)
    existing = (project.workflow or {}).get("storyboard", [])
    if existing:
        return [
            {**card, "reason": "Your saved assignment", "estimated": False}
            for card in existing
            if card["end"] > start and card["start"] < end
        ]
    cues = [
        dict(cue) for cue in project.caption_cues or [] if cue["end"] > start and cue["start"] < end
    ]
    estimated = not bool(cues)
    if not cues:
        lines = [
            line.strip() for line in re.split(r"(?<=[.!?])\s+|\n+", project.script) if line.strip()
        ]
        lines = [line[i : i + 300] for line in lines for i in range(0, len(line), 300)]
        if not lines:
            return []
        total = sum(len(line.split()) for line in lines)
        cursor = start
        for line in lines:
            finish = min(end, cursor + (end - start) * len(line.split()) / total)
            cues.append({"start": cursor, "end": finish, "text": line})
            cursor = finish
    result = []
    for index, cue in enumerate(cues):
        words = tokens(cue["text"])
        ranked = [
            (
                len(words & tokens(p.characters)) * 4
                + len(words & tokens(p.fight)) * 2
                + len(words & tokens(p.title + " " + p.series)),
                p,
            )
            for p in panels
        ]
        score, panel = max(ranked, key=lambda item: item[0]) if ranked else (0, None)
        if not score and panels:
            panel = panels[min(len(panels) - 1, int(index * len(panels) / max(1, len(cues))))]
        if panel:
            result.append(
                {
                    **cue,
                    "panel_id": panel.id,
                    "beat": beat_for(cue["text"]),
                    "estimated": estimated,
                    "reason": "Matched character / fight tags"
                    if score
                    else "Story-order fallback; choose the right panel",
                }
            )
    return result


def build_draft(project, scenes, panels, options, pauses, effects):
    from types import SimpleNamespace

    settings = project.settings
    start, end = audio_range(settings, project.narration_duration)
    sources = scenes or [
        SimpleNamespace(**SceneInput(panel_id=p.id).model_dump(), sfx_key=None) for p in panels
    ]
    for source in sources:
        if not source.id:
            source.id = uid()
    # Generate relative to the selected recording range, rather than resetting it.
    local_settings = {**settings, "narration_start": 0, "narration_end": end - start}
    local_pauses = [
        [max(0, a - start), min(end - start, b - start)] for a, b in pauses if b > start and a < end
    ]
    cut = auto_edit(
        sources, local_settings, end - start, AutoEditInput(pace=options.pace), local_pauses
    )
    cut["settings"] = {**cut["settings"], "narration_start": start, "narration_end": end}
    cards = storyboard(project, panels)
    source_by_id = {s.id: s for s in sources}
    reasons, cursor = [], 0
    for index, scene in enumerate(cut["scenes"]):
        old = source_by_id.get(scene["id"])
        if old and getattr(old, "locked", False):
            reasons.append("Locked shot preserved")
            cursor += scene["duration"]
            continue
        middle = start + cursor + scene["duration"] / 2
        card = next((c for c in cards if c["start"] <= middle < c["end"]), None)
        if card is None and cards:
            card = min(cards, key=lambda c: abs(c["start"] - middle))
        why = ["Paced to narration"]
        if options.match_panels and card:
            scene["panel_id"] = card["panel_id"]
            why.append(card["reason"])
        beat = card.get("beat", "custom") if card else "custom"
        if not options.camera_moves:
            if old:
                for key in (
                    "motion",
                    "motion_strength",
                    "easing",
                    "transition",
                    "transition_duration",
                ):
                    scene[key] = getattr(old, key)
            else:
                scene.update(motion="hold", transition="cut")
        elif beat in BEATS:
            scene.update(BEATS[beat], beat=beat, framing="fit" if beat == "read" else "fill")
            if beat == "hit" and index % 2:
                scene["motion"] = "impact_shake"
            why.append(f"{beat.title()} camera preset")
        # At most one effect per spoken cue, never over an uploaded/custom effect.
        cue_start = max(0, card["start"] - start) if card else -1
        if (
            options.sound_effects
            and beat in {"hit", "reveal", "reaction"}
            and cursor <= cue_start < cursor + scene["duration"]
            and not (old and old.sfx_key)
        ):
            kind = {"hit": "impact", "reveal": "whoosh", "reaction": "reaction"}[beat]
            preferred = (project.workflow or {}).get("sound_choices", {}).get(kind)
            effect = next((effect for effect in effects if effect.id == preferred), None) or next(
                (effect for effect in effects if effect.kind == kind), None
            )
            if effect:
                scene.update(sfx_id=effect.id, sfx_offset=round(cue_start - cursor, 3))
                why.append(f"{effect.name} at {cue_start:.2f}s")
        reasons.append(" · ".join(why))
        cursor += scene["duration"]
    return {
        **cut,
        "reasons": reasons,
        "storyboard": cards,
        "cues": project.caption_cues or [],
        "notice": "Tag and timing suggestions; review the match, framing, and wording. No image understanding is used.",
    }


def short_candidates(project, scenes, panels=()):
    start, end = audio_range(project.settings, project.narration_duration)
    cards = [c for c in storyboard(project, panels) if c["end"] > start and c["start"] < end]
    # Caption text is available even when no panel assignments exist.
    if not cards:
        cards = [c for c in project.caption_cues or [] if c["end"] > start and c["start"] < end]
    candidates = []
    starts = sorted({start, *(max(start, c["start"]) for c in cards)})
    for a in starts:
        limit = min(end, a + 30)
        endings = [c["end"] for c in cards if a + min(12, end - a) <= c["end"] <= limit]
        b = max(endings) if endings else limit
        if b - a < min(8, end - start):
            continue
        inside = [c for c in cards if c["start"] >= a and c["start"] < b]
        text = " ".join(c["text"] for c in inside)
        score = len(tokens(text) & IMPACTS) * 3 + len(tokens(text) & REVEALS) * 2
        if inside and "?" in inside[0]["text"]:
            score += 2
        if inside and inside[-1]["text"].endswith((".", "!", "?")):
            score += 1
        candidates.append(
            {
                "start": round(a - start, 3),
                "end": round(b - start, 3),
                "text": text[:500],
                "score": score,
                "reason": "Action words and sentence boundaries"
                if cards
                else "Timing-only candidate; add captions for better suggestions",
            }
        )
    selected = []
    for candidate in sorted(candidates, key=lambda c: (-c["score"], c["start"])):
        if all(abs(candidate["start"] - c["start"]) >= 5 for c in selected):
            selected.append(candidate)
        if len(selected) == 3:
            break
    return selected


def section_snapshot(snapshot, start, end):
    result = copy.deepcopy(snapshot)
    fps = result["settings"]["fps"]
    total = timeline_duration(result["scenes"], fps)
    a, b = round(start * fps) / fps, round(end * fps) / fps
    if not 0 <= a < b <= total + 0.001 or b - a < 0.25:
        raise ValueError("Choose at least 0.25 seconds within the timeline")
    scenes, cursor = [], 0
    for original in result["scenes"]:
        length = scene_frames(original["duration"], fps) / fps
        left, right = max(a, cursor), min(b, cursor + length)
        if right > left:
            scene = {
                **original,
                "duration": right - left,
                "motion_total_frames": scene_frames(original["duration"], fps),
                "motion_offset_frames": round((left - cursor) * fps),
            }
            if original.get("sfx_key") or original.get("sfx_id"):
                sfx_time = cursor + original.get("sfx_offset", 0)
                if sfx_time >= right:
                    scene.update(sfx_key=None, sfx_id=None)
                else:
                    scene["sfx_offset"] = max(0, sfx_time - left)
                    scene["sfx_trim"] = max(0, left - sfx_time)
            scenes.append(scene)
        cursor += length
    voice_start = result["settings"].get("narration_start", 0)
    result["settings"].update(narration_start=voice_start + a, narration_end=voice_start + b)
    result.update(scenes=scenes, section={"start": a, "end": b}, music_offset=a)
    return result


def missing_assets(snapshot, storage):
    keys = [snapshot.get(key) for key in ("narration_key", "music_key", "logo_key")]
    keys += [
        scene.get(key) for scene in snapshot.get("scenes", []) for key in ("storage_key", "sfx_key")
    ]
    return [key for key in dict.fromkeys(keys) if key and not storage.path(key).is_file()]


def export_filename(job):
    title = (
        re.sub(r"[^A-Za-z0-9_-]+", "_", job.snapshot.get("title", "Comic_Beatdowns")).strip("_")[
            :100
        ]
        or "Comic_Beatdowns"
    )
    kind = (
        "Section"
        if job.snapshot.get("section")
        else "Draft"
        if job.snapshot.get("quality") == "draft"
        else "Final"
    )
    return f"{title}_{kind}_v{job.project_revision:03}_{job.id[:6]}.mp4"


def ensure_builtin_effects(db, storage):
    """Original synthesized effects; seeded locally, no third-party audio assets."""
    for kind, name, duration in [
        ("impact", "Studio impact", 0.24),
        ("whoosh", "Studio whoosh", 0.4),
        ("reaction", "Studio reaction", 0.3),
    ]:
        from sqlalchemy import select

        effect = db.scalar(select(SoundEffect).where(SoundEffect.id == f"builtin-{kind}"))
        key = f"sfx/builtin-{kind}.wav"
        if not storage.path(key).is_file():
            path = storage.path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            rng, samples, rate = random.Random(42), array("h"), 48000
            for i in range(round(rate * duration)):
                t = i / rate
                envelope = math.exp(-t * (20 if kind == "impact" else 8))
                value = (
                    (rng.uniform(-1, 1) * 0.4 + math.sin(2 * math.pi * (75 - 30 * t) * t) * 0.6)
                    if kind == "impact"
                    else rng.uniform(-1, 1) * math.sin(math.pi * t / duration)
                    if kind == "whoosh"
                    else math.sin(2 * math.pi * (700 - 1400 * t) * t)
                )
                samples.append(round(value * envelope * 9000))
            import sys

            if sys.byteorder != "little":
                samples.byteswap()
            with wave.open(str(path), "wb") as output:
                output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                output.writeframes(samples.tobytes())
        if not effect:
            db.add(
                SoundEffect(
                    id=f"builtin-{kind}", name=name, kind=kind, storage_key=key, duration=duration
                )
            )
    db.commit()
