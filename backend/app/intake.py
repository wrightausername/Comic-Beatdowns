"""Read-only source eligibility for M1 intake, not Smart Crop/timeline preflight."""

import hashlib
import math
import re
from collections import Counter
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .api import get_or_404, session
from .autoedit import audio_range
from .database import DirectorJob, Project, RenderJob
from .production import check_assets, project_panels
from .renderer import tools_available
from .schemas import VideoSettings
from .verdict_provider import connection_status

router = APIRouter(prefix="/api")


def words(text):
    return Counter(re.findall(r"[^\W_]+", text.casefold()))


@router.get("/projects/{project_id}/intake-readiness")
def intake_readiness(
    project_id: str,
    request: Request,
    mode: Literal["basic", "vision"] = "basic",
    base_revision: int | None = Query(default=None, ge=1),
    db: Session = Depends(session),
):
    project = get_or_404(db, Project, project_id)
    storage = request.app.state.storage
    panels = project_panels(db, project)
    checks = []

    def add(code, state, message, confirm=False):
        checks.append({"code": code, "state": state, "message": message, "confirm": confirm})

    if base_revision is not None and project.revision != base_revision:
        add(
            "stale_revision",
            "blocking",
            "This saved project changed. Open it in the editor before retrying.",
        )
    add(
        "panels",
        "ready" if panels else "blocking",
        f"{len(panels)} recognized project panel(s)."
        if panels
        else "Add authorized images, PDF pages or a CBZ containing images.",
    )
    missing_ids = set((project.workflow or {}).get("panel_ids", [])) - {p.id for p in panels}
    missing = [a for a in check_assets(project_id, request, db)["assets"] if a["missing"]]
    if missing or missing_ids:
        add(
            "missing_assets",
            "blocking",
            "Original source files or panel records are missing. Open Add files → Recover missing files in the editor.",
        )
    else:
        add("sources", "ready", "Referenced source files are available in private storage.")
    seen, duplicate_count = set(), 0
    for panel in panels:
        path = storage.path(panel.storage_key)
        if path.is_file():
            with path.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").digest()
            duplicate_count += digest in seen
            seen.add(digest)
    if duplicate_count:
        add(
            "duplicate_artwork",
            "notice",
            f"{duplicate_count} repeated artwork file(s). Review whether this repetition is intentional.",
        )
    duration = project.narration_duration
    valid_voice = bool(
        project.narration_key and duration and math.isfinite(duration) and 0.25 <= duration <= 180
    )
    selected = None
    if valid_voice:
        try:
            start, end = audio_range(
                VideoSettings.model_validate(project.settings).model_dump(), duration
            )
            selected = end - start
        except ValueError:
            valid_voice = False
    add(
        "narration",
        "ready" if valid_voice else "blocking",
        f"Verdict recording: {duration:.2f}s; selected {selected:.2f}s."
        if valid_voice
        else "Upload one valid Verdict narration recording (0.25–180 seconds). A script is not a voice track; voice synthesis is not implemented.",
    )
    if valid_voice and not 65 <= selected <= 90:
        add(
            "creative_target",
            "notice",
            "65–90 seconds is an advisory target. The supplied recording will not be shortened to meet it.",
        )
    connection = connection_status(request.app.state.settings)
    if mode == "vision":
        add(
            "vision",
            "ready" if connection["configured"] else "blocking",
            "Saved Vision connection available; explicit authorization is required before sending artwork."
            if connection["configured"]
            else "Connect a Vision model in the existing Autopilot card, or explicitly choose Basic local.",
        )
        if len(panels) > 30:
            add(
                "vision_limit",
                "blocking",
                "Vision supports up to 30 project panels per run. Select fewer panels or explicitly choose Basic local.",
            )
    else:
        add(
            "basic",
            "notice",
            "Basic runs locally using upload order, tags and timing. It does not understand comic artwork.",
        )
    if not project.script.strip():
        add(
            "script_optional",
            "notice",
            "No optional script supplied. Narration is still required; no script-to-voice generation will run.",
        )
    if not project.caption_cues:
        add(
            "captions_optional",
            "notice",
            "No optional SRT supplied. Verdict can attempt speech recognition; caption wording needs review.",
        )
    if project.script.strip() and project.caption_cues:
        script_words = words(project.script)
        caption_words = words(" ".join(c["text"] for c in project.caption_cues))
        overlap = sum((script_words & caption_words).values()) / max(
            1, sum(script_words.values()), sum(caption_words.values())
        )
        if overlap < 0.65:
            add(
                "script_caption_mismatch",
                "notice",
                "Script and SRT wording differ. This text check cannot verify the recording. Confirm you will review the wording in the preview.",
                True,
            )
    if valid_voice and any(c["end"] > duration + 0.25 for c in project.caption_cues):
        add(
            "caption_range",
            "notice",
            "Some SRT timestamps extend past the recording. Those captions can be clipped; review or replace the SRT.",
            True,
        )
    active_director = db.scalar(
        select(DirectorJob.id).where(
            DirectorJob.project_id == project_id,
            DirectorJob.status.in_(["queued", "working", "rendering"]),
        )
    )
    active_render = db.scalar(
        select(RenderJob.id).where(
            RenderJob.project_id == project_id, RenderJob.status.in_(["queued", "running"])
        )
    )
    if active_director or active_render:
        add(
            "active_job",
            "blocking",
            "This project already has a director or render job. Open the saved project to follow its progress.",
        )
    if not tools_available(request.app.state.settings):
        add("ffmpeg", "blocking", "Install FFmpeg and FFprobe before creating a preview.")
    return {
        "project_id": project.id,
        "base_revision": project.revision,
        "ready": not any(c["state"] == "blocking" for c in checks),
        "panel_count": len(panels),
        "narration_duration": duration,
        "checks": checks,
    }
