"""Compact, source-free edit observations for later review.

An edit is evidence of change, not evidence that the original AI decision was bad.
Do not feed these observations into generation without creator approval.
"""

from .workspace import PROJECT_FIELDS, SCENE_FIELDS

OBSERVED_PROJECT_FIELDS = tuple(key for key in PROJECT_FIELDS if key != "title")
OBSERVED_SCENE_FIELDS = tuple(key for key in SCENE_FIELDS if key != "id")
MAX_CHANGE_ITEMS = 120


def summarize_workspace_change(before: dict, after: dict) -> list[dict]:
    """Return bounded changed field *names* only, with no personal text or media paths."""
    changes = []
    changed_project = [
        key
        for key in OBSERVED_PROJECT_FIELDS
        if before["project"].get(key) != after["project"].get(key)
    ]
    if changed_project:
        changes.append({"target": "project", "fields": changed_project})

    old = {scene["id"]: scene for scene in before["scenes"]}
    new = {scene["id"]: scene for scene in after["scenes"]}
    ids = list(dict.fromkeys([*old, *new]))
    omitted = 0
    for scene_id in ids:
        if scene_id not in old:
            fields = ["added"]
        elif scene_id not in new:
            fields = ["removed"]
        else:
            fields = [
                field
                for field in OBSERVED_SCENE_FIELDS
                if old[scene_id].get(field) != new[scene_id].get(field)
            ]
        if not fields:
            continue
        if len(changes) < MAX_CHANGE_ITEMS:
            changes.append({"target": "scene", "scene_id": scene_id, "fields": fields})
        else:
            omitted += 1

    if omitted:
        changes.append({"target": "overflow", "scene_count": omitted})
    return changes
