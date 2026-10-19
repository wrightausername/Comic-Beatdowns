"""Guided production APIs. All suggested edits are returned for review first."""

import copy
import io
import math
import tempfile
import wave
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .api import (
    get_or_404,
    project_dict,
    queue_render,
    save_audio,
    scene_dict,
    scenes_for,
    session,
    touch,
    upload_bytes,
)
from .audio import analyze_audio, pcm_audio, transcribe
from .autoedit import audio_range
from .automation import (
    build_draft,
    short_candidates,
    storyboard,
)
from .database import InboxFile, Panel, Project, ProjectVersion, Scene, SoundEffect, uid
from .importer import import_to_library
from .renderer import normalize_audio, run, timeline_duration
from .schemas import (
    AudioPrepareInput,
    BatchRenderInput,
    BuildDraftInput,
    PanelMetadata,
    RevisionInput,
    VersionInput,
    VideoSettings,
    WatchInput,
)
from .storage import media_url
from .workspace import locked_project, remember, snapshot

router = APIRouter(prefix="/api")
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".cbz"}
AUDIO_EXTS = {".wav", ".mp3", ".m4a", ".ogg", ".flac", ".aac", ".webm"}


def project_panels(db, project):
    ids = list(
        dict.fromkeys(
            [
                *(project.workflow or {}).get("panel_ids", []),
                *(s.panel_id for s in scenes_for(db, project.id)),
            ]
        )
    )
    return [p for panel_id in ids if (p := db.get(Panel, panel_id))]


def effect_dict(effect):
    return {
        "id": effect.id,
        "name": effect.name,
        "kind": effect.kind,
        "duration": effect.duration,
        "url": media_url(effect.storage_key),
    }


@router.get("/sound-effects")
def list_effects(db: Session = Depends(session)):
    return [effect_dict(effect) for effect in db.scalars(select(SoundEffect))]


@router.post("/sound-effects", status_code=201)
async def add_effect(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(""),
    kind: str = Form("impact"),
    db: Session = Depends(session),
):
    if kind not in {"impact", "whoosh", "reaction"}:
        raise HTTPException(422, "Choose impact, whoosh, or reaction")
    filename = Path(file.filename or "Sound effect").stem
    key, duration = await save_audio(file, request, "sfx", 30)
    effect = SoundEffect(
        name=(name.strip() or filename)[:120], kind=kind, storage_key=key, duration=duration
    )
    db.add(effect)
    db.commit()
    return effect_dict(effect)


@router.get("/projects/{project_id}/storyboard")
def get_storyboard(project_id: str, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    project.settings = VideoSettings.model_validate(project.settings).model_dump()
    return {
        "cards": storyboard(project, project_panels(db, project)),
        "has_timed_captions": bool(project.caption_cues),
    }


@router.post("/projects/{project_id}/build-draft")
async def suggest_draft(
    project_id: str, options: BuildDraftInput, request: Request, db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Add narration in step 1 first")
    panels, scenes = project_panels(db, project), scenes_for(db, project_id)
    if not panels:
        raise HTTPException(422, "Add project panels in step 1 first")
    project.settings = VideoSettings.model_validate(project.settings).model_dump()
    config, storage = request.app.state.settings, request.app.state.storage
    try:
        analysis = await run_in_threadpool(
            analyze_audio, storage.path(project.narration_key), config
        )
        if options.captions and not project.caption_cues:
            if not request.app.state.caption_lock.acquire(False):
                raise HTTPException(409, "Caption recognition is busy. Try again shortly.")
            try:
                # In-memory draft only. The project is not changed by this request.
                cues = await run_in_threadpool(
                    transcribe, storage.path(project.narration_key), config
                )
            finally:
                request.app.state.caption_lock.release()
        else:
            cues = project.caption_cues or []
        working = copy.copy(project)
        working.caption_cues = cues
        result = build_draft(
            working,
            scenes,
            panels,
            options,
            analysis["pauses"],
            list(db.scalars(select(SoundEffect))),
        )
        result["base_revision"] = project.revision
        return result
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/projects/{project_id}/shorts")
def suggest_shorts(project_id: str, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Add narration first")
    return {
        "candidates": short_candidates(
            project, scenes_for(db, project_id), project_panels(db, project)
        )
    }


@router.post("/projects/{project_id}/duplicate", status_code=201)
def duplicate_project(project_id: str, data: VersionInput, db: Session = Depends(session)):
    original = get_or_404(db, Project, project_id)
    state = snapshot(db, original)
    values = {**state["project"], "title": data.name.strip()}
    if not values["title"]:
        raise HTTPException(422, "Give the new episode a name")
    duplicate = Project(**values, status="scripting", script_approved=False)
    db.add(duplicate)
    db.flush()
    for scene in state["scenes"]:
        db.add(Scene(**{**scene, "id": uid(), "project_id": duplicate.id, "locked": False}))
    db.commit()
    return project_dict(duplicate, db, True)


@router.get("/projects/{project_id}/versions")
def list_versions(project_id: str, db: Session = Depends(session)):
    get_or_404(db, Project, project_id)
    return [
        {"id": v.id, "name": v.name, "created_at": v.created_at}
        for v in db.scalars(
            select(ProjectVersion)
            .where(ProjectVersion.project_id == project_id)
            .order_by(ProjectVersion.created_at.desc())
        )
        if v.snapshot.get("kind") != "audio"
    ]


@router.post("/projects/{project_id}/versions", status_code=201)
def save_version(project_id: str, data: VersionInput, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    if not data.name.strip():
        raise HTTPException(422, "Give the version a name")
    versions = list(
        db.scalars(select(ProjectVersion).where(ProjectVersion.project_id == project_id))
    )
    if sum(v.snapshot.get("kind") != "audio" for v in versions) >= 40:
        raise HTTPException(
            422,
            "Keep up to 40 named versions per project. Delete an old version first.",
        )
    version = ProjectVersion(
        project_id=project_id, name=data.name.strip(), snapshot=snapshot(db, project)
    )
    db.add(version)
    db.commit()
    return {"id": version.id, "name": version.name}


def version_for(db, project_id, version_id):
    version = get_or_404(db, ProjectVersion, version_id)
    if version.project_id != project_id:
        raise HTTPException(404, "This version belongs to another project")
    return version


@router.get("/projects/{project_id}/versions/{version_id}")
def preview_version(project_id: str, version_id: str, db: Session = Depends(session)):
    version = version_for(db, project_id, version_id)
    if version.snapshot.get("kind") == "audio":
        raise HTTPException(404, "Use the audio preview controls")
    values = version.snapshot
    project = {**project_dict(get_or_404(db, Project, project_id), db, True), **values["project"]}
    project.update(
        narration_url=media_url(values["project"]["narration_key"]),
        music_url=media_url(values["project"].get("music_key")),
        logo_url=media_url(values["project"].get("logo_key")),
    )
    project["scenes"] = [
        scene_dict(Scene(**scene, project_id=project_id), db) for scene in values["scenes"]
    ]
    return project


def restore_version(db, project, version):
    remember(db, project)
    for key, value in version.snapshot["project"].items():
        setattr(project, key, copy.deepcopy(value))
    for scene in scenes_for(db, project.id):
        db.delete(scene)
    db.flush()
    for scene in version.snapshot["scenes"]:
        db.add(Scene(**scene, project_id=project.id))
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/versions/{version_id}/restore")
def accept_version(
    project_id: str, version_id: str, data: RevisionInput, db: Session = Depends(session)
):
    project = locked_project(db, project_id, data.base_revision)
    version = version_for(db, project_id, version_id)
    if (
        version.snapshot.get("kind") == "audio"
        and version.snapshot.get("base_revision") != project.revision
    ):
        raise HTTPException(
            409, "The project changed after this audio preview. Generate a new preview first."
        )
    return restore_version(db, project, version)


@router.delete("/projects/{project_id}/versions/{version_id}")
def delete_version(project_id: str, version_id: str, db: Session = Depends(session)):
    db.delete(version_for(db, project_id, version_id))
    db.commit()
    return {"deleted": True}


@router.post("/projects/{project_id}/audio/prepare")
async def prepare_audio(
    project_id: str, data: AudioPrepareInput, request: Request, db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Upload narration first")
    if not data.reduce_noise and not data.shorten_pauses:
        raise HTTPException(422, "Choose noise reduction or shorter pauses")
    # Retain a bounded set of preview records. Referenced media remains available
    # to saved versions and undo snapshots even after a preview is discarded.
    previews = [
        v
        for v in db.scalars(
            select(ProjectVersion)
            .where(ProjectVersion.project_id == project_id)
            .order_by(ProjectVersion.created_at.desc())
        )
        if v.snapshot.get("kind") == "audio"
    ]
    for preview in previews[4:]:
        db.delete(preview)
    storage, config = request.app.state.storage, request.app.state.settings
    state = snapshot(db, project)
    start, end = audio_range(
        VideoSettings.model_validate(project.settings).model_dump(), project.narration_duration
    )
    try:
        pcm, _ = await run_in_threadpool(pcm_audio, storage.path(project.narration_key), config)
        analysis = await run_in_threadpool(
            analyze_audio, storage.path(project.narration_key), config
        )
        removed = []
        if data.shorten_pauses:
            removed = [
                (max(start, a + 0.12), min(end, b - 0.12))
                for a, b in analysis["pauses"]
                if min(b, end) - max(a, start) > 0.6
            ]
        segments, cursor = [], start
        for a, b in removed:
            if b > a:
                if a > cursor:
                    segments.append((cursor, a))
                cursor = b
        if cursor < end:
            segments.append((cursor, end))
        if sum(b - a for a, b in segments) < 0.25:
            segments = [(start, end)]

        def mapped(time):
            return sum(max(0, min(b, time) - a) for a, b in segments if time > a) + max(
                0, time - end
            )

        narration_duration = mapped(end)
        # Quantize cumulative boundaries once. Rounding each shortened shot
        # independently drifts on fast timelines, and discarding short remnants
        # without carrying their time forward would cut off narration.
        fps = project.settings.get("fps", 24)
        padding = max(0, timeline_duration(state["scenes"], fps) - (end - start))
        target = math.ceil((narration_duration + padding) * fps - 1e-6)
        minimum, maximum = math.ceil(0.25 * fps), 30 * fps
        new_scenes, cursor, kept_end = [], 0, 0
        originals = state["scenes"]
        for index, scene in enumerate(originals):
            finish = cursor + round(scene["duration"] * fps) / fps
            boundary = (
                target
                if index == len(originals) - 1
                else min(target, round(mapped(start + finish) * fps))
            )
            frames = boundary - kept_end
            original_frames = round(scene["duration"] * fps)
            if scene.get("locked") and frames != original_frames:
                raise ValueError(
                    "Shortening pauses would change a locked shot. Unlock it or choose noise reduction only."
                )
            if frames >= minimum:
                if frames > maximum:
                    raise ValueError(
                        "Fit narration or split long shots before cleaning this recording."
                    )
                sfx_time = mapped(start + cursor + scene.get("sfx_offset", 0)) - kept_end / fps
                new_scenes.append(
                    {
                        **scene,
                        "duration": scene["duration"] if scene.get("locked") else frames / fps,
                        "sfx_offset": max(0, sfx_time),
                        "position": len(new_scenes),
                    }
                )
                kept_end = boundary
            cursor = finish
        if new_scenes and kept_end < target:
            tail = new_scenes[-1]
            frames = round(tail["duration"] * fps) + target - kept_end
            if tail.get("locked") or frames > maximum:
                raise ValueError("Unlock or split the last shot so the cleaned narration fits.")
            tail["duration"] = frames / fps
        # Do not create a zero-scene result from silence or very short shots.
        if state["scenes"] and not new_scenes:
            raise ValueError(
                "The pause trim would remove every scene. Choose noise reduction only."
            )
        key = f"narration/{uid()}.wav"
        output = storage.path(key)
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=config.data_dir) as directory:
            raw = Path(directory) / "trimmed.wav"
            with wave.open(str(raw), "wb") as wav:
                wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
                wav.writeframes(
                    b"".join(pcm[round(a * 16000) * 2 : round(b * 16000) * 2] for a, b in segments)
                )
            command = [config.ffmpeg, "-y", "-nostdin", "-v", "error", "-i", str(raw)]
            if data.reduce_noise:
                command += ["-af", "highpass=f=70,lowpass=f=7500,afftdn=nf=-25"]
            command += ["-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(output)]
            await run_in_threadpool(run, command)

        def retime_cues(cues):
            return [
                {**c, "start": mapped(max(start, c["start"])), "end": mapped(min(end, c["end"]))}
                for c in cues
                if c["end"] > start
                and c["start"] < end
                and mapped(min(end, c["end"])) > mapped(max(start, c["start"]))
            ]

        state["project"].update(
            narration_key=key,
            narration_duration=narration_duration,
            caption_cues=retime_cues(project.caption_cues or []),
            settings={
                **VideoSettings.model_validate(project.settings).model_dump(),
                "narration_start": 0,
                "narration_end": narration_duration,
            },
        )
        workflow = state["project"].get("workflow", {})
        if workflow.get("storyboard"):
            workflow["storyboard"] = retime_cues(workflow["storyboard"])
        if workflow.get("notes"):
            workflow["notes"] = [
                {**n, "time": mapped(start + n["time"])} for n in workflow["notes"]
            ]
        state.update(scenes=new_scenes, kind="audio", base_revision=project.revision)
        version = ProjectVersion(
            project_id=project_id, name="Audio cleanup preview", snapshot=state
        )
        db.add(version)
        db.commit()
        return {
            "id": version.id,
            "before_url": media_url(project.narration_key),
            "after_url": media_url(key),
            "duration": narration_duration,
            "removed_seconds": max(0, end - start - narration_duration),
            "base_revision": project.revision,
        }
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def classify_file(filename):
    path = Path(filename)
    if path.suffix.lower() in IMAGE_EXTS:
        return "panels"
    if path.suffix.lower() in AUDIO_EXTS:
        stem = path.stem.lower()
        return (
            "music"
            if stem.startswith(("music", "bgm"))
            else "sfx"
            if stem.startswith(("sfx", "effect", "impact", "whoosh"))
            else "narration"
        )
    if path.suffix.lower() == ".srt":
        return "captions"
    raise ValueError("Choose images, PDF, CBZ, audio, or SRT captions")


def ingest_file(db, project, raw, filename, kind, storage, config, commit=True):
    """Shared by the drop zone and the local watched folder."""
    if len(raw) > config.max_upload_bytes:
        raise ValueError("File exceeds 64 MB")
    if kind == "auto":
        kind = classify_file(filename)
    remember(db, project)
    if kind == "panels":
        panels = []
        try:
            import_to_library(
                raw, filename, PanelMetadata(), storage, panels, config.max_panels_per_import
            )
        except Exception:
            for panel in panels:
                storage.delete(panel.storage_key)
                storage.delete(panel.thumbnail_key)
            raise
        db.add_all(panels)
        db.flush()
        ids = list(
            dict.fromkeys([*(project.workflow or {}).get("panel_ids", []), *(p.id for p in panels)])
        )
        project.workflow = {**(project.workflow or {}), "panel_ids": ids}
        message = f"Added {len(panels)} panel(s)"
    elif kind in {"narration", "music", "sfx"}:
        key = f"{kind}/{uid()}.wav"
        with tempfile.TemporaryDirectory(dir=config.data_dir) as directory:
            path = Path(directory) / "input.bin"
            path.write_bytes(raw)
            duration = normalize_audio(
                path, storage.path(key), config, 30 if kind == "sfx" else 180
            )
        if kind == "sfx":
            db.add(
                SoundEffect(
                    name=Path(filename).stem[:120],
                    kind="whoosh" if "whoosh" in filename.lower() else "impact",
                    storage_key=key,
                    duration=duration,
                )
            )
        else:
            if kind == "narration":
                # Timing changes are explicit, while cameras and scene order survive.
                project.caption_cues = []
                project.workflow = {**(project.workflow or {}), "storyboard": []}
                project.settings = {
                    **VideoSettings.model_validate(project.settings).model_dump(),
                    "narration_start": 0,
                    "narration_end": None,
                }
            setattr(project, f"{kind}_key", key)
            setattr(project, f"{kind}_duration", duration)
        message = f"Added {kind}"
    elif kind == "captions":
        from .audio import parse_srt
        from .schemas import CaptionList

        project.caption_cues = CaptionList(cues=parse_srt(raw.decode("utf-8-sig"))).model_dump()[
            "cues"
        ]
        message = "Imported timed captions"
    else:
        raise ValueError("Choose panels, narration, music, sound effect, or captions")
    touch(project, invalidate_approval=True)
    if commit:
        db.commit()
    return message


@router.post("/projects/{project_id}/import-file", status_code=201)
async def import_project_file(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    kind: str = Form("auto"),
    db: Session = Depends(session),
):
    project = get_or_404(db, Project, project_id)
    raw = await upload_bytes(file, request.app.state.settings.max_upload_bytes)
    try:
        message = await run_in_threadpool(
            ingest_file,
            db,
            project,
            raw,
            Path(file.filename or "file.png").name[:240],
            kind,
            request.app.state.storage,
            request.app.state.settings,
        )
        return {"project": project_dict(project, db, True), "message": message}
    except (ValueError, UnicodeError) as error:
        db.rollback()
        raise HTTPException(422, str(error)) from error


@router.get("/projects/{project_id}/asset-check")
def check_assets(project_id: str, request: Request, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    storage = request.app.state.storage
    assets = []
    for kind in ("narration", "music", "logo"):
        key = getattr(project, f"{kind}_key")
        if key:
            assets.append(
                {
                    "kind": kind,
                    "id": project_id,
                    "name": kind.title(),
                    "missing": not storage.path(key).is_file(),
                }
            )
    for panel in project_panels(db, project):
        assets.append(
            {
                "kind": "panel",
                "id": panel.id,
                "name": panel.title,
                "missing": not storage.path(panel.storage_key).is_file(),
            }
        )
    for scene in scenes_for(db, project_id):
        if scene.sfx_key:
            assets.append(
                {
                    "kind": "sfx",
                    "id": scene.id,
                    "name": f"Scene {scene.position + 1} sound",
                    "missing": not storage.path(scene.sfx_key).is_file(),
                }
            )
    return {"assets": assets}


@router.post("/projects/{project_id}/recover-file")
async def recover_file(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    kind: str = Form(...),
    asset_id: str = Form(...),
    db: Session = Depends(session),
):
    project = get_or_404(db, Project, project_id)
    storage, config = request.app.state.storage, request.app.state.settings
    if kind == "panel":
        panel = get_or_404(db, Panel, asset_id)
        if panel.id not in {p.id for p in project_panels(db, project)}:
            raise HTTPException(404, "Panel does not belong to this project")
        key = panel.storage_key
    elif kind == "sfx":
        scene = get_or_404(db, Scene, asset_id)
        if scene.project_id != project_id:
            raise HTTPException(404, "Scene does not belong to this project")
        key = scene.sfx_key
    elif kind in {"narration", "music", "logo"}:
        key = getattr(project, f"{kind}_key")
    else:
        raise HTTPException(422, "Choose a missing project asset")
    if not key or storage.path(key).is_file():
        raise HTTPException(
            409, "Only missing files can be reconnected here. Use Replace for existing assets."
        )
    raw = await upload_bytes(file, config.max_upload_bytes)
    try:
        if kind in {"panel", "logo"}:
            with Image.open(io.BytesIO(raw)) as image:
                if image.width * image.height > 32_000_000:
                    raise ValueError("Choose an image under 32 megapixels")
                if kind == "panel" and image.size != (panel.width, panel.height):
                    raise ValueError("Choose the original panel with the same dimensions")
                output = io.BytesIO()
                image.convert("RGBA" if kind == "logo" else "RGB").save(output, "PNG")
                storage.write(key, output.getvalue())
                if kind == "panel":
                    thumb = image.convert("RGB")
                    thumb.thumbnail((360, 480))
                    output = io.BytesIO()
                    thumb.save(output, "JPEG")
                    storage.write(panel.thumbnail_key, output.getvalue())
        else:
            with tempfile.TemporaryDirectory(dir=config.data_dir) as directory:
                source = Path(directory) / "input.bin"
                source.write_bytes(raw)
                temporary = Path(directory) / "normalized.wav"
                duration = await run_in_threadpool(
                    normalize_audio, source, temporary, config, 30 if kind == "sfx" else 180
                )
                expected = (
                    project.narration_duration
                    if kind == "narration"
                    else project.music_duration
                    if kind == "music"
                    else None
                )
                if expected and abs(duration - expected) > 0.05:
                    raise ValueError(
                        "Choose the original audio with the same duration; use Replace audio for a different recording"
                    )
                storage.write(key, temporary.read_bytes())
        return {"recovered": True}
    except (OSError, ValueError) as error:
        raise HTTPException(422, str(error)) from error


@router.get("/projects/{project_id}/inbox")
def inbox_status(project_id: str, request: Request, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    path = request.app.state.storage.path(f"inbox/{project_id}")
    path.mkdir(parents=True, exist_ok=True)
    return {
        "path": str(path),
        "enabled": project.watch_enabled,
        "files": [
            {"id": f.id, "name": f.filename, "status": f.status, "message": f.message}
            for f in db.scalars(
                select(InboxFile).where(InboxFile.project_id == project_id).order_by(InboxFile.id)
            ).all()
        ][-50:],
    }


@router.put("/projects/{project_id}/inbox")
def enable_inbox(project_id: str, data: WatchInput, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    project.watch_enabled = data.enabled
    db.commit()
    return {"enabled": project.watch_enabled}


@router.post("/renders/batch", status_code=202)
def batch_export(data: BatchRenderInput, request: Request, db: Session = Depends(session)):
    jobs, errors = [], []
    with request.app.state.render_lock:
        for project_id in dict.fromkeys(data.project_ids):
            try:
                jobs.append(queue_render(project_id, request, db))
            except HTTPException as error:
                db.rollback()
                errors.append({"project_id": project_id, "message": str(error.detail)})
    return {"jobs": jobs, "errors": errors}
