"""Atomic workspace persistence and bounded, durable undo/redo snapshots."""

import copy

from fastapi import HTTPException
from sqlalchemy import select, text

from .database import Panel, Project, Scene, uid
from .renderer import timeline_duration

PROJECT_FIELDS = (
    "title",
    "idea",
    "script",
    "settings",
    "caption_cues",
    "narration_key",
    "narration_duration",
    "music_key",
    "music_duration",
    "logo_key",
)
SCENE_FIELDS = (
    "id",
    "panel_id",
    "position",
    "duration",
    "motion",
    "motion_strength",
    "easing",
    "focus_x",
    "focus_y",
    "transition",
    "transition_duration",
    "caption",
    "sfx_key",
)


def locked_project(db, project_id, revision):
    # A write reservation makes checking the revision and saving one transaction.
    db.execute(text("BEGIN IMMEDIATE"))
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(404, "This project no longer exists")
    if project.revision != revision:
        raise HTTPException(
            409,
            "This project changed in another window. Your local draft is kept; reload before saving.",
        )
    return project


def project_scenes(db, project_id):
    return list(
        db.scalars(select(Scene).where(Scene.project_id == project_id).order_by(Scene.position))
    )


def snapshot(db, project):
    return copy.deepcopy(
        {
            "project": {key: getattr(project, key) for key in PROJECT_FIELDS},
            "scenes": [
                {key: getattr(scene, key) for key in SCENE_FIELDS}
                for scene in project_scenes(db, project.id)
            ],
        }
    )


def remember(db, project):
    history = project.edit_history or {}
    project.edit_history = {
        "past": [*history.get("past", []), snapshot(db, project)][-50:],
        "future": [],
    }


def replace_workspace_scenes(db, project, items, fps):
    if timeline_duration([{"duration": item.duration} for item in items], fps) > 180:
        raise HTTPException(422, "Timeline may be at most 180 seconds")
    ids = [item.id for item in items if item.id]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Scene IDs must be unique")
    old = {scene.id: scene for scene in project_scenes(db, project.id)}
    for item in items:
        if not db.get(Panel, item.panel_id):
            raise HTTPException(422, "A source panel is missing")
        if item.id and item.id not in old:
            existing = db.get(Scene, item.id)
            if (
                existing is not None
                or len(item.id) != 32
                or any(c not in "0123456789abcdef" for c in item.id)
            ):
                raise HTTPException(422, "Scene IDs must belong to this project")
    for scene in old.values():
        if scene.id not in ids:
            db.delete(scene)
    for position, item in enumerate(items):
        scene = old.get(item.id) or Scene(id=item.id or uid(), project_id=project.id)
        for key, value in item.model_dump(exclude={"id"}).items():
            setattr(scene, key, value)
        scene.position = position
        db.add(scene)


def restore(db, project, direction):
    history = copy.deepcopy(project.edit_history or {})
    source, target = ("past", "future") if direction == "undo" else ("future", "past")
    available = history.get(source, [])
    if not available:
        raise HTTPException(409, f"Nothing to {direction}")
    current = snapshot(db, project)
    saved = available.pop()
    history[source] = available
    history[target] = [*history.get(target, []), current][-50:]
    for key, value in saved["project"].items():
        setattr(project, key, value)
    for scene in project_scenes(db, project.id):
        db.delete(scene)
    db.flush()
    for values in saved["scenes"]:
        db.add(Scene(project_id=project.id, **values))
    project.edit_history = history
