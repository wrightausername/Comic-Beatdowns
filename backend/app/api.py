import hmac
import io
import tempfile
import time
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .audio import analyze_audio, parse_srt, srt_text, transcribe
from .auth import COOKIE, SESSION_AGE, authenticated, session_cookie
from .autoedit import audio_range, auto_edit
from .database import Panel, Project, RenderJob, Scene, Template, now, uid
from .importer import import_to_library, save_panel
from .panel_detection import suggest_panels
from .integrations import OpenAICompatibleWriter
from .renderer import normalize_audio, timeline_duration, tools_available
from .schemas import (
    AutoEditInput,
    CaptionGenerateInput,
    CaptionList,
    Crop,
    SmartCropSelection,
    Login,
    PanelMetadata,
    ProjectCreate,
    ProjectUpdate,
    RenderInput,
    RevisionInput,
    SceneList,
    TemplateInput,
    VideoSettings,
    WorkspaceInput,
)
from .storage import media_url
from .workspace import locked_project, remember, replace_workspace_scenes, restore

router = APIRouter(prefix="/api")


def session(request: Request):
    with request.app.state.sessions() as db:
        yield db


def get_or_404(db, model, object_id):
    obj = db.get(model, object_id)
    if obj is None:
        raise HTTPException(404, "This item no longer exists")
    return obj


def panel_dict(panel):
    return {
        "id": panel.id,
        "title": panel.title,
        "series": panel.series,
        "issue": panel.issue,
        "page": panel.page,
        "characters": panel.characters,
        "fight": panel.fight,
        "width": panel.width,
        "height": panel.height,
        "source_name": panel.source_name,
        "parent_id": panel.parent_id,
        "created_at": panel.created_at,
        "image_url": media_url(panel.storage_key),
        "thumbnail_url": media_url(panel.thumbnail_key),
    }


def scene_dict(scene, db):
    return {
        "id": scene.id,
        "panel_id": scene.panel_id,
        "position": scene.position,
        "duration": scene.duration,
        "motion": scene.motion,
        "motion_strength": scene.motion_strength,
        "easing": scene.easing,
        "focus_x": scene.focus_x,
        "focus_y": scene.focus_y,
        "transition": scene.transition,
        "transition_duration": scene.transition_duration,
        "caption": scene.caption,
        "sfx_url": media_url(scene.sfx_key),
        "sfx_id": scene.sfx_id,
        "sfx_offset": scene.sfx_offset,
        "locked": scene.locked,
        "note": scene.note,
        "beat": scene.beat,
        "framing": scene.framing,
        "sfx_source_id": scene.id if scene.sfx_key else None,
        "panel": panel_dict(db.get(Panel, scene.panel_id)),
    }


def scenes_for(db, project_id):
    return list(
        db.scalars(select(Scene).where(Scene.project_id == project_id).order_by(Scene.position))
    )


def project_dict(project, db, detail=False):
    scenes = scenes_for(db, project.id)
    settings = VideoSettings.model_validate(project.settings).model_dump()
    duration = timeline_duration([{"duration": s.duration} for s in scenes], settings["fps"])
    result = {
        "id": project.id,
        "title": project.title,
        "idea": project.idea,
        "status": project.status,
        "script": project.script,
        "script_approved": project.script_approved,
        "settings": settings,
        "narration_url": media_url(project.narration_key),
        "narration_duration": project.narration_duration,
        "music_url": media_url(project.music_key),
        "music_duration": project.music_duration,
        "logo_url": media_url(project.logo_key),
        "caption_cues": project.caption_cues,
        "workflow": project.workflow,
        "watch_enabled": project.watch_enabled,
        "autopilot": project.autopilot,
        "can_undo": bool((project.edit_history or {}).get("past")),
        "can_redo": bool((project.edit_history or {}).get("future")),
        "revision": project.revision,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
        "scene_count": len(scenes),
        "duration": duration,
        "cover_url": media_url(db.get(Panel, scenes[0].panel_id).thumbnail_key) if scenes else None,
    }
    if detail:
        result["scenes"] = [scene_dict(s, db) for s in scenes]
    return result


def job_dict(job):
    return {
        "id": job.id,
        "project_id": job.project_id,
        "project_revision": job.project_revision,
        "title": job.snapshot.get("title", "Untitled"),
        "status": job.status,
        "progress": job.progress,
        "download_url": f"/api/renders/{job.id}/download" if job.output_key else None,
        "video_url": media_url(job.output_key),
        "error": job.error,
        "created_at": job.created_at,
        "finished_at": job.finished_at,
        "quality": job.snapshot.get("quality", "final"),
        "section": job.snapshot.get("section"),
    }


def touch(project, *, invalidate_approval=False):
    project.revision += 1
    project.updated_at = now()
    if invalidate_approval:
        project.script_approved = False
        project.autopilot = {**(project.autopilot or {}), "voice_approved": False}
    project.status = "ready" if project.script_approved else "scripting"


@router.get("/health")
def health(request: Request):
    return {"status": "ok", "ffmpeg_available": tools_available(request.app.state.settings)}


@router.get("/auth/session")
def auth_session(request: Request):
    return {"authenticated": authenticated(request)}


@router.post("/auth/login")
def login(data: Login, request: Request, response: Response):
    # Small in-memory limiter; the MVP runs one worker behind a private HTTPS proxy.
    client = request.client.host if request.client else "unknown"
    attempts = request.app.state.login_attempts
    recent = [t for t in attempts.get(client, []) if time.monotonic() - t < 60]
    if len(recent) >= 10:
        raise HTTPException(429, "Too many sign-in attempts. Wait a minute.")
    attempts[client] = [*recent, time.monotonic()]
    settings = request.app.state.settings
    if not hmac.compare_digest(data.token.encode(), settings.studio_token.encode()):
        raise HTTPException(401, "Incorrect studio access token")
    attempts.pop(client, None)
    response.set_cookie(
        COOKIE,
        session_cookie(settings.studio_token),
        max_age=SESSION_AGE,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return {"authenticated": True}


@router.post("/auth/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"authenticated": False}


@router.get("/panels")
def list_panels(q: str = "", db: Session = Depends(session)):
    statement = select(Panel)
    if q.strip():
        term = f"%{q.strip()[:200]}%"
        statement = statement.where(
            or_(
                *(
                    getattr(Panel, col).ilike(term)
                    for col in ["title", "series", "issue", "characters", "fight"]
                )
            )
        )
    return [panel_dict(p) for p in db.scalars(statement.order_by(Panel.created_at.desc()))]


async def upload_bytes(upload: UploadFile, limit: int):
    data = bytearray()
    try:
        while chunk := await upload.read(1024 * 1024):
            if len(data) + len(chunk) > limit:
                raise HTTPException(413, "Upload exceeds the 64 MB batch limit")
            data.extend(chunk)
    finally:
        await upload.close()
    if not data:
        raise HTTPException(422, "The uploaded file is empty")
    return bytes(data)


@router.post("/panels/import", status_code=201)
async def import_panels(
    request: Request,
    files: list[UploadFile] = File(...),
    metadata: str = Form("{}"),
    db: Session = Depends(session),
):
    if not 1 <= len(files) <= 20:
        raise HTTPException(422, "Import between 1 and 20 files at a time")
    try:
        values = PanelMetadata.model_validate_json(metadata)
    except ValidationError as e:
        raise HTTPException(422, "Invalid panel metadata") from e
    storage, config = request.app.state.storage, request.app.state.settings
    panels, total_bytes = [], 0
    try:
        for upload in files:
            filename = Path(upload.filename or "image.png").name[:240]
            content = await upload_bytes(upload, config.max_upload_bytes - total_bytes)
            total_bytes += len(content)
            await run_in_threadpool(
                import_to_library,
                content,
                filename,
                values,
                storage,
                panels,
                config.max_panels_per_import,
            )
        db.add_all(panels)
        db.commit()
    except Exception as e:
        db.rollback()
        for panel in panels:
            storage.delete(panel.storage_key)
            storage.delete(panel.thumbnail_key)
        if isinstance(e, HTTPException):
            raise
        if isinstance(e, ValueError):
            raise HTTPException(422, str(e)) from e
        raise
    finally:
        for upload in files:
            await upload.close()
    return [panel_dict(p) for p in panels]


@router.patch("/panels/{panel_id}")
def update_panel(panel_id: str, data: PanelMetadata, db: Session = Depends(session)):
    panel = get_or_404(db, Panel, panel_id)
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(panel, key, value)
    db.commit()
    return panel_dict(panel)


@router.get("/panels/{panel_id}/smart-crops")
def smart_crop_candidates(panel_id: str, request: Request, db: Session = Depends(session)):
    """Local read-only page segmentation. Empty means manual cropping is needed."""
    source = get_or_404(db, Panel, panel_id)
    with Image.open(request.app.state.storage.path(source.storage_key)) as image:
        candidates = suggest_panels(image)
    return {
        "candidates": candidates,
        "method": "straight_pale_gutters",
        "notice": (
            "Conservative straight-gutter suggestions, not character or action recognition. "
            "Confirm the outlined panels before creating crops."
        ),
    }


@router.post("/panels/{panel_id}/smart-crops", status_code=201)
def create_smart_crops(
    panel_id: str, data: SmartCropSelection, request: Request, db: Session = Depends(session)
):
    """Create explicitly selected child panels without changing the source page."""
    source = get_or_404(db, Panel, panel_id)
    storage = request.app.state.storage
    with Image.open(storage.path(source.storage_key)) as image:
        candidates = suggest_panels(image)
        if not candidates:
            raise HTTPException(422, "No clear straight gutters found. Crop this page manually.")
        if len(set(data.indices)) != len(data.indices):
            raise HTTPException(422, "Choose each suggested panel once")
        if any(index >= len(candidates) for index in data.indices):
            raise HTTPException(422, "Panel suggestion no longer exists. Analyze the page again.")
        created = []
        try:
            for index in sorted(data.indices):
                choice = candidates[index]
                x1 = round(choice["x"] * image.width)
                y1 = round(choice["y"] * image.height)
                x2 = round((choice["x"] + choice["width"]) * image.width)
                y2 = round((choice["y"] + choice["height"]) * image.height)
                region = image.crop((x1, y1, x2, y2))
                metadata = PanelMetadata(
                    **{key: getattr(source, key) for key in PanelMetadata.model_fields}
                )
                metadata.title = f"{source.title[:172]} · panel {index + 1}"
                created.append(
                    save_panel(
                        region, metadata, source.source_name, None, storage, parent_id=source.id
                    )
                )
            db.add_all(created)
            db.commit()
        except Exception:
            db.rollback()
            for panel in created:
                storage.delete(panel.storage_key)
                storage.delete(panel.thumbnail_key)
            raise
    return [panel_dict(panel) for panel in created]


@router.post("/panels/{panel_id}/crop", status_code=201)
def crop_panel(panel_id: str, data: Crop, request: Request, db: Session = Depends(session)):
    source = get_or_404(db, Panel, panel_id)
    if data.x + data.width > 1.000001 or data.y + data.height > 1.000001:
        raise HTTPException(422, "Crop must stay inside the image")
    storage = request.app.state.storage
    with Image.open(storage.path(source.storage_key)) as image:
        box = (
            round(data.x * image.width),
            round(data.y * image.height),
            round((data.x + data.width) * image.width),
            round((data.y + data.height) * image.height),
        )
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            raise HTTPException(422, "Crop must be at least 2 × 2 pixels")
        cropped = image.crop(box)
        if data.output_width:
            height = round(data.output_width * cropped.height / cropped.width)
            if height > 4096:
                raise HTTPException(422, "Resized panel must fit within 4096 × 4096 pixels")
            cropped = cropped.resize((data.output_width, max(1, height)), Image.Resampling.LANCZOS)
        metadata = PanelMetadata(**{k: getattr(source, k) for k in PanelMetadata.model_fields})
        metadata.title = f"{source.title[:190]} · crop"
        panel = save_panel(
            cropped, metadata, source.source_name, None, storage, parent_id=source.id
        )
    db.add(panel)
    db.commit()
    return panel_dict(panel)


@router.get("/projects")
def list_projects(db: Session = Depends(session)):
    return [
        project_dict(p, db) for p in db.scalars(select(Project).order_by(Project.updated_at.desc()))
    ]


@router.post("/projects", status_code=201)
def create_project(data: ProjectCreate, db: Session = Depends(session)):
    if not data.title.strip():
        raise HTTPException(422, "Give this project a title")
    settings = VideoSettings().model_dump()
    template = None
    if data.template_id:
        template = get_or_404(db, Template, data.template_id)
        # Audio selections belong to the original recording, not the brand kit.
        settings = {
            **VideoSettings.model_validate(template.settings).model_dump(),
            "narration_start": 0,
            "narration_end": None,
        }
    project = Project(title=data.title.strip(), idea=data.idea, settings=settings)
    if template:
        project.logo_key, project.music_key, project.music_duration = (
            template.logo_key,
            template.music_key,
            template.music_duration,
        )
    db.add(project)
    db.commit()
    return project_dict(project, db, True)


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(session)):
    return project_dict(get_or_404(db, Project, project_id), db, True)


@router.patch("/projects/{project_id}")
def update_project(project_id: str, data: ProjectUpdate, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    values = data.model_dump(exclude_unset=True)
    if any(value is None for value in values.values()):
        raise HTTPException(422, "Project fields cannot be null")
    if "title" in values and not values["title"].strip():
        raise HTTPException(422, "Give this project a title")
    changed_script = "script" in values and values["script"] != project.script
    if changed_script and values.get("script_approved"):
        raise HTTPException(422, "Save the script revision before approving it")
    if values != {"script_approved": True}:
        remember(db, project)
    touch(project, invalidate_approval=changed_script or "settings" in values)
    for key, value in values.items():
        setattr(project, key, value)
    if (
        project.script_approved
        and not project.script.strip()
        and not (project.autopilot or {}).get("voice_approved")
    ):
        raise HTTPException(422, "Write a script before approving it")
    project.status = "ready" if project.script_approved else "scripting"
    db.commit()
    return project_dict(project, db, True)


@router.put("/projects/{project_id}/scenes")
def replace_scenes(project_id: str, data: SceneList, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    remember(db, project)
    if (
        timeline_duration([{"duration": s.duration} for s in data.scenes], project.settings["fps"])
        > 180
    ):
        raise HTTPException(422, "Timeline may be at most 180 seconds")
    old = {s.id: s for s in scenes_for(db, project_id)}
    ids = [s.id for s in data.scenes if s.id]
    if len(set(ids)) != len(ids) or any(i not in old for i in ids):
        raise HTTPException(422, "Scene IDs must be unique and belong to this project")
    for item in data.scenes:
        get_or_404(db, Panel, item.panel_id)
    replace_workspace_scenes(db, project, data.scenes, project.settings["fps"])
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


async def save_audio(upload, request, folder, max_duration):
    config, storage = request.app.state.settings, request.app.state.storage
    content = await upload_bytes(upload, config.max_upload_bytes)
    key = f"{folder}/{uid()}.wav"
    try:
        with tempfile.TemporaryDirectory(dir=config.data_dir) as directory:
            raw = Path(directory) / "upload.bin"
            raw.write_bytes(content)
            duration = await run_in_threadpool(
                normalize_audio, raw, storage.path(key), config, max_duration
            )
        return key, duration
    except ValueError as e:
        storage.delete(key)
        raise HTTPException(422, str(e)) from e


@router.post("/projects/{project_id}/narration")
async def upload_narration(
    project_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    key, duration = await save_audio(file, request, "narration", 180)
    remember(db, project)
    # Older files are retained because already queued render snapshots may use them.
    project.narration_key, project.narration_duration = key, duration
    project.caption_cues = []
    project.workflow = {**(project.workflow or {}), "storyboard": []}
    values = VideoSettings.model_validate(project.settings).model_dump()
    project.settings = {**values, "narration_start": 0, "narration_end": None}
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/scenes/{scene_id}/sfx")
async def upload_sfx(
    project_id: str,
    scene_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(session),
):
    project = get_or_404(db, Project, project_id)
    scene = get_or_404(db, Scene, scene_id)
    if scene.project_id != project_id:
        raise HTTPException(404, "Scene does not belong to this project")
    remember(db, project)
    scene.sfx_key, _ = await save_audio(file, request, "sfx", 30)
    scene.sfx_id, scene.sfx_offset = None, 0
    touch(project)
    db.commit()
    return project_dict(project, db, True)


@router.delete("/projects/{project_id}/scenes/{scene_id}/sfx")
def remove_sfx(project_id: str, scene_id: str, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    scene = get_or_404(db, Scene, scene_id)
    if scene.project_id != project_id:
        raise HTTPException(404, "Scene does not belong to this project")
    remember(db, project)
    scene.sfx_key, scene.sfx_id, scene.sfx_offset = None, None, 0
    touch(project)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/renders", status_code=202)
def start_render(
    project_id: str,
    request: Request,
    data: RenderInput | None = None,
    db: Session = Depends(session),
):
    with request.app.state.render_lock:
        options = data or RenderInput()
        return queue_render(project_id, request, db, options.quality, options.start, options.end)


def queue_render(
    project_id: str, request: Request, db: Session, quality="final", start=None, end=None
):
    return queue_render_for_state(project_id, request.app.state, db, quality, start, end)


def queue_render_for_state(
    project_id, state, db, quality="final", start=None, end=None, director_job=None
):
    project = get_or_404(db, Project, project_id)
    scenes = scenes_for(db, project_id)
    if not tools_available(state.settings):
        raise HTTPException(503, "Install FFmpeg and FFprobe before rendering")
    if (
        not scenes
        or not project.narration_key
        or (quality == "final" and not project.script_approved)
    ):
        raise HTTPException(
            422, "Add scenes, upload narration, and approve the script before rendering"
        )
    active = list(db.scalars(select(RenderJob).where(RenderJob.status.in_(["queued", "running"]))))
    if len(active) >= 20 or any(j.project_id == project_id for j in active):
        raise HTTPException(409, "A render is already active for this project or the queue is full")
    settings = VideoSettings.model_validate(project.settings).model_dump()
    values = [
        {
            "duration": s.duration,
            "motion": s.motion,
            "motion_strength": s.motion_strength,
            "easing": s.easing,
            "focus_x": s.focus_x,
            "focus_y": s.focus_y,
            "transition": s.transition,
            "transition_duration": s.transition_duration,
            "caption": s.caption,
            "storage_key": db.get(Panel, s.panel_id).storage_key,
            "sfx_key": s.sfx_key,
            "sfx_offset": s.sfx_offset,
            "framing": s.framing,
        }
        for s in scenes
    ]
    try:
        voice_start, voice_end = audio_range(settings, project.narration_duration)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if voice_end - voice_start > timeline_duration(values, settings["fps"]) + 0.05:
        raise HTTPException(
            422, "Narration is longer than the timeline. Extend the scenes so no speech is cut off."
        )
    snapshot = {
        "title": project.title,
        "settings": settings,
        "scenes": values,
        "narration_key": project.narration_key,
        "script": project.script,
        "caption_cues": project.caption_cues,
        "music_key": project.music_key,
        "logo_key": project.logo_key,
        "quality": quality,
    }
    from .automation import missing_assets, section_snapshot

    missing = missing_assets(snapshot, state.storage)
    if missing:
        raise HTTPException(
            422, "Source files are missing. Open Add files → Recover missing files."
        )
    if start is not None:
        try:
            snapshot = section_snapshot(snapshot, start, end)
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
    job = RenderJob(project_id=project_id, project_revision=project.revision, snapshot=snapshot)
    if quality == "final":
        project.status = "rendering"
    db.add(job)
    if director_job is not None:
        db.flush()
        director_job.render_id = job.id
        director_job.status, director_job.stage, director_job.progress = (
            "rendering",
            "rendering",
            65,
        )
        director_job.message = (
            "Rendering your vertical MP4. You can leave this page; keep Studio running."
        )
    db.commit()
    state.renderer.enqueue(job.id)
    return job_dict(job)


@router.get("/renders")
def list_renders(project_id: str | None = None, db: Session = Depends(session)):
    query = select(RenderJob).order_by(RenderJob.created_at.desc())
    if project_id:
        query = query.where(RenderJob.project_id == project_id)
    return [job_dict(j) for j in db.scalars(query)]


@router.put("/projects/{project_id}/workspace")
def save_workspace(project_id: str, data: WorkspaceInput, db: Session = Depends(session)):
    project = locked_project(db, project_id, data.base_revision)
    if not data.title.strip():
        raise HTTPException(422, "Give this project a title")
    remember(db, project)
    replace_workspace_scenes(db, project, data.scenes, data.settings.fps)
    project.title, project.idea, project.script = data.title.strip(), data.idea, data.script
    project.settings, project.caption_cues = (
        data.settings.model_dump(),
        [cue.model_dump() for cue in data.cues],
    )
    from .automation import validate_workflow

    project.workflow = validate_workflow(data.workflow, db)
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/history/{direction}")
def history_step(
    project_id: str, direction: str, data: RevisionInput, db: Session = Depends(session)
):
    if direction not in {"undo", "redo"}:
        raise HTTPException(404, "Unknown history action")
    project = locked_project(db, project_id, data.base_revision)
    restore(db, project, direction)
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.get("/projects/{project_id}/waveform")
def waveform(project_id: str, request: Request, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Upload narration first")
    try:
        return analyze_audio(
            request.app.state.storage.path(project.narration_key), request.app.state.settings
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("/projects/{project_id}/auto-edit")
def preview_auto_edit(
    project_id: str, data: AutoEditInput, request: Request, db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Upload narration so the edit can follow its timing")
    try:
        analysis = analyze_audio(
            request.app.state.storage.path(project.narration_key), request.app.state.settings
        )
        return auto_edit(
            scenes_for(db, project_id),
            VideoSettings.model_validate(project.settings).model_dump(),
            project.narration_duration,
            data,
            analysis["pauses"],
        )
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.post("/projects/{project_id}/captions/transcribe")
async def generate_captions(
    project_id: str,
    request: Request,
    data: CaptionGenerateInput | None = None,
    db: Session = Depends(session),
):
    project = get_or_404(db, Project, project_id)
    if not project.narration_key:
        raise HTTPException(422, "Upload narration first")
    if data and data.use_script and not project.script.strip():
        raise HTTPException(422, "Save the matching script first")
    if not request.app.state.caption_lock.acquire(blocking=False):
        raise HTTPException(409, "Caption recognition is busy. Try again shortly.")
    try:
        cues = await run_in_threadpool(
            transcribe,
            request.app.state.storage.path(project.narration_key),
            request.app.state.settings,
            project.script if data and data.use_script else "",
        )
        # Return a draft, never overwrite captions edited while recognition ran.
        return {"cues": CaptionList(cues=cues).model_dump()["cues"]}
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    finally:
        request.app.state.caption_lock.release()


@router.post("/projects/{project_id}/captions/import")
async def import_captions(
    project_id: str, file: UploadFile = File(...), db: Session = Depends(session)
):
    get_or_404(db, Project, project_id)
    raw = await upload_bytes(file, 1024 * 1024)
    try:
        return CaptionList(cues=parse_srt(raw.decode("utf-8-sig"))).model_dump()
    except (ValueError, UnicodeError) as error:
        raise HTTPException(422, str(error)) from error


@router.get("/projects/{project_id}/captions/srt")
def download_captions(project_id: str, db: Session = Depends(session)):
    project = get_or_404(db, Project, project_id)
    return PlainTextResponse(
        srt_text(project.caption_cues),
        headers={"Content-Disposition": 'attachment; filename="verdict-captions.srt"'},
    )


@router.post("/projects/{project_id}/music")
async def upload_music(
    project_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    key, duration = await save_audio(file, request, "music", 180)
    remember(db, project)
    project.music_key, project.music_duration = key, duration
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/logo")
async def upload_logo(
    project_id: str, request: Request, file: UploadFile = File(...), db: Session = Depends(session)
):
    project = get_or_404(db, Project, project_id)
    raw = await upload_bytes(file, 8 * 1024 * 1024)
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 32_000_000:
                raise ValueError("Use a logo under 32 megapixels")
            logo = image.convert("RGBA")
            logo.thumbnail((1600, 1600))
            output = io.BytesIO()
            logo.save(output, "PNG")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        raise HTTPException(422, "Choose a valid image under 32 megapixels") from error
    key = f"logos/{uid()}.png"
    request.app.state.storage.write(key, output.getvalue())
    remember(db, project)
    project.logo_key = key
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.delete("/projects/{project_id}/assets/{kind}")
def remove_project_asset(project_id: str, kind: str, db: Session = Depends(session)):
    if kind not in {"music", "logo"}:
        raise HTTPException(404, "Unknown asset")
    project = get_or_404(db, Project, project_id)
    remember(db, project)
    setattr(project, f"{kind}_key", None)
    if kind == "music":
        project.music_duration = None
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.get("/renders/{job_id}")
def get_render(job_id: str, db: Session = Depends(session)):
    return job_dict(get_or_404(db, RenderJob, job_id))


@router.get("/renders/{job_id}/download")
def download_render(job_id: str, request: Request, db: Session = Depends(session)):
    job = get_or_404(db, RenderJob, job_id)
    if job.status != "completed" or not job.output_key:
        raise HTTPException(409, "This export is not complete")
    path = request.app.state.storage.public_path(job.output_key)
    if not path.is_file():
        raise HTTPException(404, "Export file is missing")
    from .automation import export_filename

    return FileResponse(path, media_type="video/mp4", filename=export_filename(job))


@router.get("/templates")
def list_templates(db: Session = Depends(session)):
    return [
        {
            "id": t.id,
            "name": t.name,
            "settings": VideoSettings.model_validate(t.settings).model_dump(),
            "logo_url": media_url(t.logo_key),
        }
        for t in db.scalars(select(Template))
    ]


@router.post("/templates", status_code=201)
def create_template(data: TemplateInput, db: Session = Depends(session)):
    if not data.name.strip():
        raise HTTPException(422, "Give this template a name")
    template = Template(name=data.name.strip(), settings=data.settings.model_dump())
    if data.project_id:
        project = get_or_404(db, Project, data.project_id)
        template.logo_key, template.music_key, template.music_duration = (
            project.logo_key,
            project.music_key,
            project.music_duration,
        )
    db.add(template)
    db.commit()
    return {"id": template.id, "name": template.name, "settings": template.settings}


@router.get("/integrations")
def integrations(request: Request):
    settings = request.app.state.settings
    return {
        "writing_enabled": bool(settings.ai_base_url and settings.ai_key and settings.ai_model),
        "comic_sources": [],
        "voice_generation_enabled": False,
        "publishing_enabled": False,
        "storage": "local",
    }


@router.post("/projects/{project_id}/draft")
def draft_script(project_id: str, request: Request, db: Session = Depends(session)):
    if not integrations(request)["writing_enabled"]:
        raise HTTPException(
            503, "Optional AI writing is not configured. The script editor works without it."
        )
    project = get_or_404(db, Project, project_id)
    panels = [panel_dict(db.get(Panel, s.panel_id)) for s in scenes_for(db, project_id)]
    try:
        draft = OpenAICompatibleWriter(request.app.state.settings).draft(
            project.idea, panels, project.script
        )
    except (ValueError, httpx.HTTPError, KeyError, IndexError, TypeError) as e:
        raise HTTPException(
            502, "The writing provider could not produce a draft. Check its configuration."
        ) from e
    return {"script": draft, "approved": False}


@router.get("/media/{key:path}")
def media(key: str, request: Request):
    try:
        path = request.app.state.storage.public_path(key)
    except ValueError as e:
        raise HTTPException(404, "File not found") from e
    if not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})
