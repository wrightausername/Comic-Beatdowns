"""Evidence-labelled story maps and recording-led cuts; never rewrite source audio."""

import hashlib
import json
import re
from difflib import SequenceMatcher


def tokens(text):
    return re.findall(r"[\w']+", text.casefold())


def narration_map(script, cues, words=()):
    """SRT boundaries stay authoritative; ASR words retain their observed timestamps.

    Text agreement is a coverage measurement, never an acoustic confidence score.
    We never manufacture word timestamps by spreading words across an SRT cue.
    """
    observed = [t for cue in cues for t in tokens(cue["text"])]
    expected = tokens(script)
    matcher = SequenceMatcher(None, expected, observed, autojunk=False)
    matched = sum(block.size for block in matcher.get_matching_blocks())
    mismatches = [
        {"script": " ".join(expected[a:b]), "recording": " ".join(observed[c:d])}
        for kind, a, b, c, d in matcher.get_opcodes()
        if kind != "equal"
    ][:30]
    return {
        "source": "local_word_recognition"
        if words
        else "timed_captions"
        if cues
        else "duration_only",
        "precision": "word" if words else "phrase" if cues else "duration",
        "script_coverage": round(matched / len(expected), 3) if expected else None,
        "mismatches": mismatches,
        "words": list(words),
        "phrases": [dict(c) for c in cues],
        "review_required": not cues or bool(expected and matched / len(expected) < 0.85),
        "limit": "Recognition and imported timestamps need review. Text coverage is not speech-recognition confidence.",
    }


def region_key(panel_id, crop):
    raw = json.dumps([panel_id, crop], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def story_map(sources, panels, cards, layouts=(), decisions=()):
    """Authored region identity is independent of the number of editorial shots."""
    known = {p.id: p for p in panels}
    layout_map = {p.panel_id: p for p in layouts}
    authored, seen = [], set()
    for source in sources:
        crop = getattr(source, "source_crop", None)
        key = region_key(source.panel_id, crop)
        if key in seen:
            continue
        seen.add(key)
        page = known[source.panel_id]
        region = None
        region_index = None
        if crop and page.id in layout_map:
            candidates = list(enumerate(layout_map[page.id].regions))
            region_index, candidate = min(
                candidates,
                key=lambda pair: sum(abs(getattr(pair[1], k) - crop[k]) for k in crop),
            )
            if sum(abs(getattr(candidate, k) - crop[k]) for k in crop) < 0.12:
                region = candidate
        authored.append(
            {
                "id": key,
                "page_id": page.id,
                "order": len(authored) + 1,
                "crop": crop,
                "region_index": region_index,
                "characters": region.characters if region else [],
                "dialogue": region.dialogue if region else "",
                "action": region.action if region else "",
                "reaction": region.reaction if region else "",
                "evidence": region.reason
                if region
                else "Source order and panel geometry; story facts are unknown locally.",
                "confidence": region.confidence if region else None,
                "review_required": region is None or region.confidence < 0.75,
            }
        )
    beats = []
    for i, card in enumerate(cards):
        decision = decisions[i][1] if i < len(decisions) else None
        candidates = [p for p in authored if p["page_id"] == card.get("panel_id")]
        if decision:
            candidates = [
                p
                for p in authored
                if p["page_id"] == decision.panel_id
                and (decision.region_index is None or p["region_index"] == decision.region_index)
            ]
        matched = candidates[0] if len(candidates) == 1 else None
        beats.append(
            {
                "start": card["start"],
                "end": card["end"],
                "text": card["text"],
                "beat": card.get("beat", "custom"),
                "authored_panel_id": matched["id"] if matched else None,
                "evidence": decision.reason
                if decision
                else "Timing and supplied order; no visual semantic match established.",
                "confidence": decision.confidence if decision else None,
                "review_required": matched is None
                or decision is None
                or decision.confidence is None
                or decision.confidence < 0.75,
            }
        )
        if matched and decision and not matched["action"]:
            for name in ("characters", "dialogue", "action", "reaction"):
                matched[name] = getattr(decision, name)
    return {
        "panels": authored,
        "beats": beats,
        "limits": "Model observations are suggestions. Local mode does not identify characters or read balloons.",
    }


def timed_cuts(scenes, settings, alignment, pauses, story):
    """Roll adjacent cuts onto evidenced boundaries, retaining exact total frames.

    Protected routes/locks/glides and their absolute intervals are never shifted.
    No free redistribution across distant shots and no fabricated word alignment.
    """
    fps = settings["fps"]
    origin = settings.get("narration_start", 0)
    cues = alignment["phrases"]
    boundaries = {round(c["end"] * fps) for c in cues}
    boundaries |= {round((a + b) / 2 * fps) for a, b in pauses}
    semantic = {
        round(b.get("event_time", b["start"]) * fps)
        for b in story["beats"]
        if b["beat"] in {"hit", "reveal"} and not b["review_required"]
    }
    boundaries |= semantic

    def protected(s):
        return s.get("locked") or s.get("camera_path") or s.get("motion") == "panel_glide"

    cursor = round(origin * fps)
    report = []
    for i, left in enumerate(scenes[:-1]):
        right = scenes[i + 1]
        old = cursor + round(left["duration"] * fps)
        if protected(left) or protected(right):
            cursor = old
            continue
        end = old + round(right["duration"] * fps)
        # A scene needs time for dialogue/reaction; never shorten those to a flash.
        minimum_left = round((1.2 if left.get("beat") in {"read", "reaction"} else 0.3) * fps)
        minimum_right = round((1.2 if right.get("beat") in {"read", "reaction"} else 0.3) * fps)
        candidates = [
            t
            for t in boundaries
            if abs(t - old) <= round(0.65 * fps)
            and minimum_left <= t - cursor <= 30 * fps
            and minimum_right <= end - t <= 30 * fps
            # Do not move a cut into the middle of a spoken phrase, except an
            # explicitly grounded action entrance or a measured pause.
            and (
                t in semantic
                or not any(c["start"] * fps + 1 < t < c["end"] * fps - 1 for c in cues)
            )
        ]
        target = min(candidates, key=lambda t: (abs(t - old), t)) if candidates else old
        if target != old:
            left["duration"], right["duration"] = (target - cursor) / fps, (end - target) / fps
            report.append(
                {
                    "scene_id": right["id"],
                    "before": (old / fps) - origin,
                    "after": (target / fps) - origin,
                    "reason": "Narrated action entrance"
                    if target in semantic
                    else "Spoken phrase or measured pause boundary",
                }
            )
        cursor = target
    return report


def sound_design(scenes, effects, settings, story, original=(), preferences=None):
    """Use only installed/user-imported assets, and never replace existing sounds."""
    originals = {s.id: s for s in original}
    preferences = preferences or {}
    choices, uses, cursor, last_event = [], {}, settings.get("narration_start", 0), -10
    for scene in scenes:
        end = cursor + scene["duration"]
        old = originals.get(scene["id"])
        if scene.get("locked") or scene.get("camera_path") or (old and (old.sfx_key or old.sfx_id)):
            cursor = end
            continue
        # Replace only automatic placement from this planning run.
        scene.update(sfx_id=None, sfx_offset=0)
        beats = [
            {**b, "start": b.get("event_time", b["start"])}
            for b in story["beats"]
            if cursor <= b.get("event_time", b["start"]) < end
        ]
        event = next((b for b in beats if b["beat"] in {"hit", "reveal"}), None)
        buildup = False
        if event is None and not any(b["beat"] in {"read", "reaction"} for b in beats):
            upcoming = next(
                (
                    b
                    for b in story["beats"]
                    if b["beat"] in {"hit", "reveal"}
                    and end <= b.get("event_time", b["start"]) <= end + 0.3
                ),
                None,
            )
            if upcoming and end - cursor >= 0.8:
                event = {**upcoming, "start": end - 0.8}
                buildup = True
        if event and event["start"] - last_event >= 0.8:
            kind = "riser" if buildup else "impact" if event["beat"] == "hit" else "whoosh"
            pool = sorted(
                (e for e in effects if e.kind == kind),
                key=lambda e: (uses.get(e.id, 0), e.id != preferences.get(kind), e.id),
            )
            if pool:
                effect = pool[0]
                uses[effect.id] = uses.get(effect.id, 0) + 1
                scene.update(sfx_id=effect.id, sfx_offset=round(event["start"] - cursor, 3))
                last_event = event["start"] - (0.8 if buildup else 0)
                choices.append(
                    {
                        "scene_id": scene["id"],
                        "time": event["start"],
                        "asset": effect.name,
                        "reason": ("Buildup before " if buildup else "")
                        + event["beat"]
                        + " cue; asset rotation and narration ducking",
                    }
                )
        elif any(b["beat"] in {"read", "reaction"} for b in beats):
            choices.append(
                {
                    "scene_id": scene["id"],
                    "time": cursor,
                    "asset": None,
                    "reason": "Leave dialogue/reaction clear; no added effect",
                }
            )
        cursor = end
    # Existing manual mixer settings stay authoritative; the renderer limits peaks.
    return choices


def place_story_artwork(scenes, settings, story):
    """Ground new shots in a known authored region while retaining page chronology."""
    panels = {p["id"]: p for p in story["panels"]}
    grounded = [
        b for b in story["beats"] if b["authored_panel_id"] in panels and not b["review_required"]
    ]
    order = [panels[b["authored_panel_id"]]["order"] for b in grounded]
    if order != sorted(order):
        return [
            "Narration revisits earlier art. Kept source chronology; review the proposed story connections."
        ]
    cursor, notices = settings.get("narration_start", 0), []
    for scene in scenes:
        middle = cursor + scene["duration"] / 2
        beat = next((b for b in grounded if b["start"] <= middle < b["end"]), None)
        if beat and not (
            scene.get("locked") or scene.get("camera_path") or scene.get("motion") == "panel_glide"
        ):
            panel = panels[beat["authored_panel_id"]]
            if panel["page_id"] == scene["panel_id"]:
                scene.update(source_crop=panel["crop"], beat=beat["beat"])
            else:
                notices.append(
                    "A narrated action refers to another page. Kept uploaded page order; check this connection."
                )
        cursor += scene["duration"]
    return list(dict.fromkeys(notices))


def locate_spoken_events(story, alignment):
    """Use observed word times when present; phrase timing is labelled as fallback."""
    keywords = {
        "hit": {
            "hit",
            "hits",
            "punch",
            "punches",
            "punched",
            "kick",
            "kicks",
            "slam",
            "smash",
            "impact",
        },
        "reveal": {"reveal", "reveals", "suddenly", "surprise", "actually"},
    }
    for beat in story["beats"]:
        candidates = [
            w
            for w in alignment["words"]
            if beat["start"] <= w["start"] < beat["end"]
            and tokens(w["text"])
            and tokens(w["text"])[0] in keywords.get(beat["beat"], set())
        ]
        beat["event_time"] = candidates[0]["start"] if candidates else beat["start"]
        beat["timing_evidence"] = (
            "Observed spoken keyword"
            if candidates
            else "Spoken phrase entrance; exact action word unverified"
        )
