"""Verdict's durable, opt-in upload-to-video director. No publishing or hidden API calls."""

import copy
import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock, Thread
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .api import get_or_404, job_dict, project_dict, queue_render_for_state, session, touch
from .audio import analyze_audio, transcribe
from .automation import build_draft, storyboard
from .database import DirectorJob, Project, ProjectVersion, RenderJob, SoundEffect, now
from .production import project_panels
from .schemas import (
    AutopilotOptions,
    AutopilotUpdate,
    BuildDraftInput,
    CaptionList,
    DirectorStart,
    SceneInput,
    VideoSettings,
    VisionConnection,
)
from .verdict_provider import (
    VisionDirector,
    connection_path,
    connection_status,
    read_connection,
    save_connection,
)
from .workspace import locked_project, remember, replace_workspace_scenes, snapshot

router = APIRouter(prefix="/api")
ACTIVE = ("queued", "working", "rendering")
logger = logging.getLogger(__name__)


def director_dict(job, db):
    render = db.get(RenderJob, job.render_id) if job.render_id else None
    return {
        "id": job.id,
        "project_id": job.project_id,
        "status": job.status,
        "stage": job.stage,
        "message": job.message,
        "progress": job.progress,
        "base_revision": job.base_revision,
        "output_revision": job.output_revision,
        "report": job.report,
        "render": job_dict(render) if render else None,
        "created_at": job.created_at,
    }


def focus_position(target, ratio, vertical=False):
    """Convert an image point to ImageOps.fit's crop-centering parameter."""
    crop = min(1, ratio / (9 / 16) if vertical else (9 / 16) / ratio)
    return 0.5 if crop >= 0.999 else min(1, max(0, (target - crop / 2) / (1 - crop)))


class DirectorService:
    def __init__(self, state):
        self.state = state
        self.sessions = state.sessions
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="verdict-director")
        self.lock = Lock()
        self.stop_event = Event()
        self.thread = Thread(target=self.monitor, name="verdict-director-monitor", daemon=True)

    def start(self):
        with self.sessions() as db:
            for job in db.scalars(
                select(DirectorJob).where(DirectorJob.status.in_(["queued", "working"]))
            ):
                job.status, job.stage = "failed", "interrupted"
                job.message = (
                    "Studio restarted during planning. Your files are safe; run Verdict again."
                )
                job.finished_at = now()
            db.commit()
        self.sync_renders()
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join(timeout=5)
        self.executor.shutdown(wait=True, cancel_futures=False)

    def monitor(self):
        while not self.stop_event.wait(2):
            try:
                self.sync_renders()
            except Exception:
                logger.exception("Could not update Verdict render progress")

    def sync_renders(self):
        with self.sessions() as db:
            for job in db.scalars(select(DirectorJob).where(DirectorJob.status == "rendering")):
                render = db.get(RenderJob, job.render_id)
                if render and render.status == "completed":
                    job.status, job.stage, job.progress = "completed", "ready", 100
                    job.message = (
                        "Your 1080p MP4 is ready."
                        if render.snapshot.get("quality") == "final"
                        else "Your preview is ready. Watch it, then approve the final MP4."
                    )
                    job.finished_at = now()
                elif not render or render.status == "failed":
                    job.status, job.stage = "failed", "render"
                    job.message = "The edit is saved, but rendering failed. Check Exports for details and retry the render."
                    job.finished_at = now()
                else:
                    job.progress = 65 + int(render.progress * 0.34)
            db.commit()

    def enqueue(self, project_id, revision):
        with self.lock, self.sessions() as db:
            project = locked_project(db, project_id, revision)
            options = AutopilotOptions.model_validate(
                {
                    k: v
                    for k, v in (project.autopilot or {}).items()
                    if k in AutopilotOptions.model_fields
                }
            )
            if not options.enabled:
                raise HTTPException(422, "Turn on Verdict Autopilot first")
            active = list(db.scalars(select(DirectorJob).where(DirectorJob.status.in_(ACTIVE))))
            if len(active) >= 5 or any(j.project_id == project_id for j in active):
                raise HTTPException(
                    409, "Verdict is already working on this project, or his queue is full"
                )
            if db.scalar(
                select(RenderJob.id).where(
                    RenderJob.project_id == project_id, RenderJob.status.in_(["queued", "running"])
                )
            ):
                raise HTTPException(409, "Let this project's current render finish first")
            panels = project_panels(db, project)
            if not project.narration_key or not panels:
                raise HTTPException(422, "Add project panels and one narration file first")
            if options.mode == "vision" and not read_connection(self.state.settings):
                raise HTTPException(422, "Connect a vision model below, or choose Basic mode")
            for key in [project.narration_key, *(p.storage_key for p in panels)]:
                if not self.state.storage.path(key).is_file():
                    raise HTTPException(
                        422,
                        "A source file is missing. Restore it in Add files → Recover missing files.",
                    )
            source = snapshot(db, project)
            source["options"] = options.model_dump()
            source["panels"] = [
                {
                    key: getattr(p, key)
                    for key in (
                        "id",
                        "storage_key",
                        "title",
                        "series",
                        "characters",
                        "fight",
                        "width",
                        "height",
                    )
                }
                for p in panels
            ]
            job = DirectorJob(project_id=project_id, base_revision=revision, snapshot=source)
            db.add(job)
            db.commit()
            result = director_dict(job, db)
            self.executor.submit(self.run, job.id)
            return result

    def progress(self, job_id, stage, progress, message):
        with self.sessions() as db:
            db.execute(text("BEGIN IMMEDIATE"))
            job = db.get(DirectorJob, job_id)
            if not job or job.status == "cancelled" or self.stop_event.is_set():
                raise InterruptedError
            job.status, job.stage, job.progress, job.message = "working", stage, progress, message
            db.commit()

    def run(self, job_id):
        try:
            self.progress(
                job_id, "listening", 10, "Listening to your narration and finding the cut points…"
            )
            with self.sessions() as db:
                source = copy.deepcopy(db.get(DirectorJob, job_id).snapshot)
            project = SimpleNamespace(**source["project"])
            panels = [SimpleNamespace(**p) for p in source["panels"]]
            scenes = [SimpleNamespace(**s) for s in source["scenes"]]
            options = AutopilotOptions.model_validate(source["options"])
            config, storage = self.state.settings, self.state.storage
            path = storage.path(project.narration_key)
            analysis = analyze_audio(path, config)
            warnings = []
            connection = read_connection(config) if options.mode == "vision" else None
            if options.mode == "vision" and not connection:
                raise ValueError(
                    "The vision connection was removed. Reconnect it or choose Basic mode."
                )
            provider = VisionDirector(connection) if connection else None
            if not project.caption_cues:
                try:
                    if provider and provider.connection.transcription_model:
                        project.caption_cues = provider.transcribe(path, config)
                    else:
                        with self.state.caption_lock:
                            project.caption_cues = transcribe(path, config)
                        if project.caption_cues:
                            warnings.append(
                                "Offline English recognition can miss names and jokes. Review the captions."
                            )
                except (ValueError, RuntimeError) as error:
                    if provider and provider.connection.transcription_model:
                        raise ValueError(str(error)) from error
                    warnings.append(
                        "Offline recognition could not produce captions. Import an SRT to add them."
                    )
                project.caption_cues = CaptionList(cues=project.caption_cues).model_dump()["cues"]
            if not project.caption_cues:
                warnings.append(
                    "No timed speech found. Captions are off; the edit uses the recording's duration."
                )
            if not project.script.strip() and project.caption_cues:
                project.script = " ".join(c["text"] for c in project.caption_cues)[:20000]
            self.progress(
                job_id,
                "planning",
                30,
                "Matching the artwork to your narration…"
                if provider
                else "Arranging panels using your order, tags, and narration timing…",
            )
            decisions = []
            crop_reviews = []
            summary = "Basic mode uses tags and upload order. It does not see the artwork."
            if provider:
                # Group tiny ASR cues into readable spoken cards. Keep exact timing/text.
                project.workflow = {**project.workflow, "storyboard": []}
                cards = storyboard(project, panels)
                grouped = []
                for card in cards:
                    if (
                        grouped
                        and card["end"] - grouped[-1]["start"] < 3
                        and len(grouped[-1]["text"]) + len(card["text"]) < 240
                    ):
                        grouped[-1].update(
                            end=card["end"], text=grouped[-1]["text"] + " " + card["text"]
                        )
                    else:
                        grouped.append(dict(card))
                plan = provider.plan(source["panels"], grouped, storage)
                decisions = list(zip(grouped, plan.assignments))
                project.workflow = {
                    **project.workflow,
                    "storyboard": [
                        {
                            "start": c["start"],
                            "end": c["end"],
                            "text": c["text"],
                            "panel_id": d.panel_id,
                            "beat": d.beat,
                        }
                        for c, d in decisions
                    ],
                }
                summary = (
                    plan.summary or "Vision AI matched panels and focal points to the narration."
                )
                # Feed validated vision assignments into the existing storyboard
                # matcher *before* building the shots. Otherwise the camera could
                # be aimed at the right action on the wrong panel.
                if any(d.confidence is not None and d.confidence < 0.55 for _, d in decisions):
                    warnings.append(
                        "Some Smart Crop targets are uncertain and use whole-panel framing. Review them before approval."
                    )
            self.progress(
                job_id,
                "editing",
                55,
                "Building camera moves, captions, transitions, and sound effects…",
            )
            with self.sessions() as db:
                effects = list(db.scalars(select(SoundEffect)))
                cut = build_draft(
                    project,
                    scenes,
                    panels,
                    BuildDraftInput(pace=options.pace, captions=bool(project.caption_cues)),
                    analysis["pauses"],
                    effects,
                )
            settings = VideoSettings.model_validate(
                {**cut["settings"], "captions": bool(project.caption_cues), "normalize_voice": True}
            ).model_dump()
            cursor = settings["narration_start"]
            panel_map = {p.id: p for p in panels}
            for shot in cut["scenes"]:
                middle = cursor + shot["duration"] / 2
                if decisions and not shot.get("locked"):
                    card, decision = min(
                        decisions,
                        key=lambda pair: abs((pair[0]["start"] + pair[0]["end"]) / 2 - middle),
                    )
                    panel = panel_map[shot["panel_id"]]
                    matches = panel.id == decision.panel_id
                    low_confidence = decision.confidence is not None and decision.confidence < 0.55
                    if matches:
                        if low_confidence:
                            # Never force a speculative close-up when the vision
                            # provider says it cannot identify the action.
                            shot.update(focus_x=0.5, focus_y=0.5, framing="fit")
                        else:
                            shot.update(
                                focus_x=focus_position(
                                    decision.target_x, panel.width / panel.height
                                ),
                                focus_y=focus_position(
                                    decision.target_y, panel.width / panel.height, vertical=True
                                ),
                                framing=decision.framing,
                            )
                    crop_reviews.append(
                        {
                            "scene_id": shot["id"],
                            "panel_id": panel.id,
                            "start": round(cursor, 3),
                            "text": card["text"][:240],
                            "target_x": decision.target_x if matches else 0.5,
                            "target_y": decision.target_y if matches else 0.5,
                            "framing": shot.get("framing", "fill"),
                            "reason": decision.reason
                            if matches
                            else "Panel assignment differs from the selected shot",
                            "confidence": decision.confidence if matches else None,
                            "review_required": (
                                not matches
                                or low_confidence
                                or decision.confidence is None
                                or decision.confidence < 0.75
                            ),
                            "applied": matches and not low_confidence,
                        }
                    )
                cursor += shot["duration"]
            items = [SceneInput.model_validate(s) for s in cut["scenes"]]
            with self.sessions() as db:
                job = db.get(DirectorJob, job_id)
                revision, project_id = job.base_revision, job.project_id
            with self.sessions() as db:
                live = locked_project(db, project_id, revision)
                job = db.get(DirectorJob, job_id)
                if job.status == "cancelled" or self.stop_event.is_set():
                    raise InterruptedError
                # Bounded automatic backup plus ordinary Undo. Never overwrite newer edits.
                previous = db.scalar(
                    select(ProjectVersion).where(
                        ProjectVersion.project_id == project_id,
                        ProjectVersion.name == "Before Verdict Autopilot",
                    )
                )
                if previous:
                    previous.snapshot, previous.created_at = snapshot(db, live), now()
                else:
                    db.add(
                        ProjectVersion(
                            project_id=project_id,
                            name="Before Verdict Autopilot",
                            snapshot=snapshot(db, live),
                        )
                    )
                remember(db, live)
                replace_workspace_scenes(db, live, items, settings["fps"])
                live.settings, live.caption_cues, live.script = (
                    settings,
                    project.caption_cues,
                    project.script,
                )
                live.workflow = {
                    **live.workflow,
                    "storyboard": [
                        {k: c[k] for k in ("start", "end", "text", "panel_id", "beat") if k in c}
                        for c in cut["storyboard"]
                    ],
                }
                touch(live, invalidate_approval=True)
                if options.delivery == "final":
                    live.autopilot = {**live.autopilot, "voice_approved": True}
                    live.script_approved = True
                job.output_revision = live.revision
                job.report = {
                    "mode": options.mode,
                    "summary": summary,
                    "warnings": warnings,
                    "scene_count": len(items),
                    "caption_count": len(project.caption_cues),
                    "smart_crops": crop_reviews,
                }
                # queue_render commits edit and immutable render together.
                queue_render_for_state(
                    project_id, self.state, db, options.delivery, director_job=job
                )

        except InterruptedError:
            self.fail(job_id, "Verdict stopped. Your last saved edit is safe.", "cancelled")
        except HTTPException as error:
            message = (
                "Your project changed while Verdict was planning. Your edits were kept. Run him again when ready."
                if error.status_code == 409 and "another window" in str(error.detail)
                else str(error.detail)
            )
            self.fail(job_id, message)
        except ValueError as error:
            self.fail(job_id, str(error)[:600])
        except Exception:
            logger.exception("Verdict planning failed")
            self.fail(
                job_id,
                "Verdict could not finish this run. Your files are safe. Retry, or use the manual editor.",
            )

    def fail(self, job_id, message, status="failed"):
        with self.sessions() as db:
            job = db.get(DirectorJob, job_id)
            if job and job.status not in ("completed", "rendering"):
                job.status, job.message, job.finished_at = status, message, now()
                db.commit()


@router.get("/verdict/connection")
def get_connection(request: Request):
    return connection_status(request.app.state.settings)


@router.put("/verdict/connection")
def put_connection(data: VisionConnection, request: Request):
    try:
        return save_connection(request.app.state.settings, data)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.delete("/verdict/connection")
def remove_connection(request: Request):
    connection_path(request.app.state.settings).unlink(missing_ok=True)
    return connection_status(request.app.state.settings)


@router.put("/projects/{project_id}/autopilot")
def set_autopilot(project_id: str, data: AutopilotUpdate, db: Session = Depends(session)):
    project = locked_project(db, project_id, data.base_revision)
    if db.scalar(
        select(DirectorJob.id).where(
            DirectorJob.project_id == project_id, DirectorJob.status.in_(ACTIVE)
        )
    ):
        raise HTTPException(409, "Wait for Verdict to finish before changing his instructions")
    project.autopilot = data.model_dump(exclude={"base_revision"})
    touch(project, invalidate_approval=True)
    db.commit()
    return project_dict(project, db, True)


@router.post("/projects/{project_id}/director", status_code=202)
def start_director(project_id: str, data: DirectorStart, request: Request):
    return request.app.state.director.enqueue(project_id, data.base_revision)


@router.get("/projects/{project_id}/director")
def list_director(project_id: str, db: Session = Depends(session)):
    get_or_404(db, Project, project_id)
    return [
        director_dict(job, db)
        for job in db.scalars(
            select(DirectorJob)
            .where(DirectorJob.project_id == project_id)
            .order_by(DirectorJob.created_at.desc())
            .limit(20)
        )
    ]


@router.post("/projects/{project_id}/director/{job_id}/cancel")
def cancel_director(project_id: str, job_id: str, db: Session = Depends(session)):
    db.execute(text("BEGIN IMMEDIATE"))
    job = get_or_404(db, DirectorJob, job_id)
    if job.project_id != project_id:
        raise HTTPException(404, "This run belongs to another project")
    if job.status not in ("queued", "working"):
        raise HTTPException(409, "Planning has finished. The render is already queued or complete.")
    job.status, job.message, job.finished_at = (
        "cancelled",
        "Verdict stopped. Your edit was kept.",
        now(),
    )
    db.commit()
    return director_dict(job, db)


@router.post("/projects/{project_id}/director/approve")
def approve_director(
    project_id: str, data: DirectorStart, request: Request, db: Session = Depends(session)
):
    project = locked_project(db, project_id, data.base_revision)
    draft = db.scalar(
        select(DirectorJob)
        .where(
            DirectorJob.project_id == project_id,
            DirectorJob.output_revision == project.revision,
            DirectorJob.render_id.is_not(None),
        )
        .order_by(DirectorJob.created_at.desc())
    )
    render = db.get(RenderJob, draft.render_id) if draft else None
    if not render or render.status != "completed" or render.snapshot.get("quality") != "draft":
        raise HTTPException(
            422, "Watch Verdict's completed preview for this revision before approving"
        )
    project.autopilot = {**project.autopilot, "voice_approved": True}
    project.script_approved = True
    touch(project)
    draft.output_revision, draft.finished_at = project.revision, None
    return queue_render_for_state(project_id, request.app.state, db, "final", director_job=draft)
