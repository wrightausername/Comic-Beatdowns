"""Saved reference recipes feeding the Studio's existing reviewed edit proposals."""

import hashlib
import math
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import Field
from sqlalchemy import select, text
from starlette.concurrency import run_in_threadpool

from .api import panel_dict, project_dict
from .database import EditProposal, Panel, ReferenceStyle, SoundEffect, uid
from .edit_assistant import get_project, proposal_dict, session
from .effects import Transition
from .reference_analysis import analyze_reference
from .renderer import scene_frames
from .schemas import RevisionInput, SceneInput, StrictModel, WorkspaceInput
from .storage import media_url

router = APIRouter(prefix="/api", tags=["Reference video styles"])
StyleMotion = Literal[
    "hold",
    "zoom_in",
    "zoom_out",
    "pan_left",
    "pan_right",
    "pan_up",
    "pan_down",
    "punch_in",
    "punch_out",
    "breathe",
    "impact_shake",
]


class StyleBeat(StrictModel):
    seconds: float = Field(ge=0.25, le=30)
    transition: Transition = "cut"
    motion: StyleMotion = "hold"


class Recipe(StrictModel):
    beats: list[StyleBeat] = Field(min_length=1, max_length=240)
    transition_duration: float = Field(ge=0.08, le=0.8, default=0.18)
    motion_strength: float = Field(ge=0.02, le=0.3, default=0.12)


class StyleUpdate(RevisionInput):
    name: str = Field(min_length=1, max_length=100)
    recipe: Recipe


class StyleOptions(StrictModel):
    first_shot: int = Field(default=0, ge=0, le=239)
    last_shot: int | None = Field(default=None, ge=0, le=239)
    intensity: float = Field(default=0.75, ge=0, le=1)
    tempo: float = Field(default=1, ge=0.5, le=2)
    pacing: bool = True
    transitions: bool = True
    camera: bool = True


class ProposeStyle(RevisionInput):
    reference_id: str = Field(max_length=64)
    reference_revision: int = Field(ge=1)
    options: StyleOptions = Field(default_factory=StyleOptions)


def style_dict(row):
    return {
        "id": row.id,
        "name": row.name,
        "source_name": row.source_name,
        "duration": row.duration,
        "analysis": row.analysis,
        "recipe": row.recipe,
        "revision": row.revision,
        "video_url": f"/api/reference-styles/{row.id}/video",
    }


def style_for(db, reference_id):
    row = db.get(ReferenceStyle, reference_id)
    if row is None:
        raise HTTPException(404, "Reference style no longer exists; choose another style")
    return row


@router.get("/reference-styles")
def list_styles(db=Depends(session)):
    return [
        style_dict(r)
        for r in db.scalars(
            select(ReferenceStyle).order_by(ReferenceStyle.created_at.desc()).limit(100)
        )
    ]


@router.post("/reference-styles", status_code=201)
async def import_reference(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(""),
    start: float = Form(0),
    end: float | None = Form(None),
    db=Depends(session),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm"}:
        raise HTTPException(422, "Choose an MP4, MOV or WebM video, up to 64 MB")
    if not request.app.state.reference_lock.acquire(blocking=False):
        raise HTTPException(409, "A reference is already being analyzed. Wait for it to finish.")
    stored = None
    try:
        with tempfile.TemporaryDirectory(prefix="cb-reference-") as temporary:
            path = Path(temporary) / ("source" + suffix)
            digest, size = hashlib.sha256(), 0
            with path.open("wb") as target:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > request.app.state.settings.max_upload_bytes:
                        raise HTTPException(
                            413, "Reference must be at most 64 MB; export a shorter clip"
                        )
                    target.write(chunk)
                    digest.update(chunk)
            if not size:
                raise HTTPException(422, "The reference file is empty")
            fingerprint = digest.hexdigest() + f":v1:{start}:{end}"
            existing = db.scalar(
                select(ReferenceStyle).where(ReferenceStyle.fingerprint == fingerprint)
            )
            if existing:
                return style_dict(existing)
            metadata, analysis, recipe = await run_in_threadpool(
                analyze_reference, path, request.app.state.settings, start, end
            )
            row = ReferenceStyle(
                id=uid(),
                name=(name.strip() or Path(file.filename).stem)[:100],
                source_name=(file.filename or "reference")[:200],
                storage_key="",
                media_type={".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm"}[
                    suffix
                ],
                fingerprint=fingerprint,
                duration=metadata["duration"],
                analysis=analysis,
                recipe=Recipe.model_validate(recipe).model_dump(),
            )
            row.storage_key = f"references/{row.id}{suffix}"
            stored = request.app.state.storage.path(row.storage_key)
            stored.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, stored)
            db.add(row)
            db.commit()
            return style_dict(row)
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        db.rollback()
        if stored:
            stored.unlink(missing_ok=True)
        detail = (
            "Analysis took too long. Choose a shorter reference range."
            if isinstance(error, subprocess.TimeoutExpired)
            else "Could not analyze the reference: " + str(error)
        )
        raise HTTPException(422, detail) from error
    finally:
        request.app.state.reference_lock.release()
        await file.close()


@router.get("/reference-styles/{reference_id}/video")
def reference_video(reference_id: str, request: Request, db=Depends(session)):
    row = style_for(db, reference_id)
    path = request.app.state.storage.path(row.storage_key)
    if not path.is_file():
        raise HTTPException(
            404, "Reference video file is missing. Its saved recipe is still usable."
        )
    return FileResponse(path, media_type=row.media_type)


@router.put("/reference-styles/{reference_id}")
def update_style(reference_id: str, data: StyleUpdate, db=Depends(session)):
    db.execute(text("BEGIN IMMEDIATE"))
    row = style_for(db, reference_id)
    if row.revision != data.base_revision:
        raise HTTPException(409, "This recipe changed in another window. Reload the saved styles.")
    if not data.name.strip():
        raise HTTPException(422, "Give this style a name")
    row.name, row.recipe, row.revision = (
        data.name.strip(),
        data.recipe.model_dump(),
        row.revision + 1,
    )
    db.commit()
    return style_dict(row)


@router.delete("/reference-styles/{reference_id}")
def delete_style(reference_id: str, data: RevisionInput, request: Request, db=Depends(session)):
    db.execute(text("BEGIN IMMEDIATE"))
    row = style_for(db, reference_id)
    if row.revision != data.base_revision:
        raise HTTPException(409, "This recipe changed; reload before deleting it")
    key = row.storage_key
    db.delete(row)
    db.commit()
    request.app.state.storage.delete(key)
    return {"ok": True}


def allocate_frames(total, weights, minimum, maximum):
    """Proportional integer timing with exact totals and Studio shot bounds."""
    if not minimum * len(weights) <= total <= maximum * len(weights):
        raise ValueError(
            "The selected shots cannot fit this rhythm within the timeline's duration limits"
        )
    result = [minimum] * len(weights)
    open_indices, remaining = set(range(len(weights))), total - minimum * len(weights)
    while open_indices and remaining:
        weight_sum = sum(weights[i] for i in open_indices)
        allocations = {i: remaining * weights[i] / weight_sum for i in open_indices}
        fixed = [i for i in open_indices if allocations[i] >= maximum - result[i]]
        if fixed:
            for i in fixed:
                remaining -= maximum - result[i]
                result[i] = maximum
                open_indices.remove(i)
            continue
        increments = {i: math.floor(allocations[i]) for i in open_indices}
        left = remaining - sum(increments.values())
        for i in open_indices:
            result[i] += increments[i]
        for i in sorted(open_indices, key=lambda n: (-(allocations[n] - increments[n]), n))[:left]:
            result[i] += 1
        break
    return result


def compile_style_plan(plan, project, db):
    if plan["project_id"] != project.id or plan["base_revision"] != project.revision:
        raise HTTPException(
            409, "This reference proposal belongs to an older video revision. Propose it again."
        )
    style = style_for(db, plan["reference_id"])
    if style.revision != plan["reference_revision"]:
        raise HTTPException(409, "The reference recipe changed. Preview a fresh style proposal.")
    options, recipe = (
        StyleOptions.model_validate(plan["options"]),
        Recipe.model_validate(style.recipe),
    )
    state = project_dict(project, db, True)
    old = state["scenes"]
    last = len(old) - 1 if options.last_shot is None else options.last_shot
    if not old or not 0 <= options.first_shot <= last < len(old):
        raise ValueError("Select a valid first and last shot")
    if options.intensity == 0 or not (options.pacing or options.transitions or options.camera):
        raise ValueError("Choose some style intensity and at least one part to transfer")
    fps = state["settings"]["fps"]

    def protected(s):
        return s["locked"] or bool(s["camera_path"]) or s["motion"] == "panel_glide"

    def fixed_time(s):
        return protected(s) or bool(s["caption"].strip() or s["sfx_url"] or s["sfx_id"])

    originals = [
        SceneInput.model_validate({k: v for k, v in s.items() if k in SceneInput.model_fields})
        for s in old
    ]
    output, capacity, i, rhythm_index = [], 240 - len(old), 0, 0
    owners = {s["id"]: k for k, s in enumerate(old)}
    while i < len(old):
        if not options.pacing or not options.first_shot <= i <= last or fixed_time(old[i]):
            output.append(originals[i].model_copy(deep=True))
            if options.first_shot <= i <= last and not protected(old[i]):
                rhythm_index += 1
            i += 1
            continue
        j = i + 1
        while j <= last and not fixed_time(old[j]):
            j += 1
        group = old[i:j]
        total = sum(scene_frames(s["duration"], fps) for s in group)
        current_average = total / (fps * len(group))
        reference_average = sum(b.seconds for b in recipe.beats) / len(recipe.beats) / options.tempo
        desired_average = (
            current_average * (1 - options.intensity) + reference_average * options.intensity
        )
        count = min(
            total // math.ceil(0.25 * fps),
            len(group) + capacity,
            max(len(group), math.ceil(total / fps / desired_average)),
        )
        capacity -= count - len(group)
        copies = [1] * len(group)
        for _ in range(count - len(group)):
            source = max(range(len(group)), key=lambda n: group[n]["duration"] / (copies[n] + 1))
            copies[source] += 1
        weights = [
            recipe.beats[(rhythm_index + n) % len(recipe.beats)].seconds for n in range(count)
        ]
        lengths = allocate_frames(total, weights, math.ceil(0.25 * fps), 30 * fps)
        offset = 0
        for n, copies_for_source in enumerate(copies):
            for copy in range(copies_for_source):
                shot = originals[i + n].model_copy(deep=True)
                shot.duration = lengths[offset] / fps
                if copy:
                    shot.id = uuid5(UUID(plan["seed"]), f"{shot.id}:{copy}").hex
                    owners[shot.id] = i + n
                    (
                        shot.caption,
                        shot.sfx_id,
                        shot.sfx_source_id,
                        shot.sfx_offset,
                        shot.clear_sfx,
                    ) = "", None, None, 0, True
                output.append(shot)
                offset += 1
        rhythm_index += count
        i = j
    old_by_id = {s["id"]: s for s in old}
    # Match source ownership even for added reframings; never import footage/audio from the reference.
    beat_index = 0
    for shot in output:
        source = old[owners[shot.id]]
        if options.first_shot <= owners[shot.id] <= last and not protected(source):
            beat = recipe.beats[beat_index % len(recipe.beats)]
            if (beat_index * 0.61803398875) % 1 < options.intensity:
                if options.transitions:
                    shot.transition = beat.transition
                    shot.transition_duration = recipe.transition_duration
                if options.camera:
                    shot.motion = beat.motion
                    shot.motion_strength = round(
                        shot.motion_strength * (1 - options.intensity)
                        + recipe.motion_strength * options.intensity,
                        4,
                    )
                    shot.easing = (
                        "ease_out"
                        if beat.motion.startswith("punch") or beat.motion == "impact_shake"
                        else "smooth"
                    )
            beat_index += 1
    before_cursor = after_cursor = 0
    old_start = {}
    for source in old:
        old_start[source["id"]] = before_cursor
        before_cursor += scene_frames(source["duration"], fps)
    changes = []
    if len(output) != len(old):
        changes.append({"field": "Timeline shots", "before": len(old), "after": len(output)})
    for position, shot in enumerate(output):
        source = old_by_id.get(shot.id)
        if source and protected(source):
            original = originals[old.index(source)]
            if shot.model_dump() != original.model_dump() or old_start[shot.id] != after_cursor:
                raise ValueError(
                    "Reference styling cannot change or move locked shots or custom camera routes"
                )
        if source:
            for field in (
                "duration",
                "motion",
                "motion_strength",
                "easing",
                "transition",
                "transition_duration",
            ):
                after = getattr(shot, field)
                if source[field] != after:
                    changes.append(
                        {
                            "shot": position + 1,
                            "field": field,
                            "before": source[field],
                            "after": after,
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
                        "motion_strength": shot.motion_strength,
                    },
                }
            )
        after_cursor += scene_frames(shot.duration, fps)
    if after_cursor != before_cursor:
        raise ValueError("Reference styling must preserve the exact timeline duration")
    if not changes:
        raise ValueError(
            "This style would not change the selected shots. Adjust the recipe or choose unlocked shots."
        )
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


def workspace_preview(project, workspace, db):
    state = project_dict(project, db, True)
    originals = {s["id"]: s for s in state["scenes"]}
    scenes = []
    for position, shot in enumerate(workspace.scenes):
        source = originals.get(shot.sfx_source_id or shot.id, {})
        effect = db.get(SoundEffect, shot.sfx_id) if shot.sfx_id else None
        sound = (
            None
            if shot.clear_sfx
            else media_url(effect.storage_key)
            if effect
            else source.get("sfx_url")
        )
        scenes.append(
            {
                **shot.model_dump(),
                "position": position,
                "panel": panel_dict(db.get(Panel, shot.panel_id)),
                "sfx_url": sound,
            }
        )
    return {
        **state,
        "settings": workspace.settings.model_dump(),
        "script": workspace.script,
        "caption_cues": [c.model_dump() for c in workspace.cues],
        "scenes": scenes,
    }


@router.post("/projects/{project_id}/reference-style/proposals", status_code=201)
def propose_style(project_id: str, data: ProposeStyle, db=Depends(session)):
    project = get_project(db, project_id)
    plan = {
        "kind": "reference_style",
        "project_id": project_id,
        "base_revision": data.base_revision,
        "reference_id": data.reference_id,
        "reference_revision": data.reference_revision,
        "options": data.options.model_dump(),
        "seed": uid(),
    }
    try:
        _, changes = compile_style_plan(plan, project, db)
    except (ValueError, TypeError) as error:
        raise HTTPException(422, str(error)) from error
    row = EditProposal(
        project_id=project_id, base_revision=data.base_revision, plan=plan, changes=changes
    )
    db.add(row)
    for previous in db.scalars(
        select(EditProposal)
        .where(EditProposal.project_id == project_id)
        .order_by(EditProposal.created_at.desc())
        .offset(49)
    ):
        db.delete(previous)
    db.commit()
    return proposal_dict(row)
