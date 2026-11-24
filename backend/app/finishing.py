"""Revision-safe finishing through the existing review queue and FFmpeg renderer."""

import json
import math
import re
import subprocess
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from .api import project_dict, queue_render
from .database import RenderJob
from .edit_assistant import get_project, review_queue, session
from .renderer import timeline_duration
from .schemas import RevisionInput
from .workspace import locked_project

router = APIRouter(prefix="/api", tags=["Finishing"])


def finding(code, message, seconds=None, severity="warning"):
    return {
        "code": code,
        "message": message,
        "seconds": seconds,
        "scene_index": None,
        "severity": severity,
    }


def scan_render(path, config, snapshot):
    """Inspect actual streams and decode the mix; visual/audio intent remains human review."""
    probe = subprocess.run(
        [config.ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        timeout=15,
    )
    if probe.returncode:
        raise ValueError("The rendered MP4 could not be inspected. Render a fresh review copy.")
    media = json.loads(probe.stdout)
    video = next((s for s in media.get("streams", []) if s["codec_type"] == "video"), None)
    audio = next((s for s in media.get("streams", []) if s["codec_type"] == "audio"), None)
    values = []
    expected_size = (360, 640) if snapshot.get("quality") == "draft" else (1080, 1920)
    if video is None or (video.get("width"), video.get("height")) != expected_size:
        values.append(
            finding(
                "render_dimensions",
                "Rendered dimensions differ from the expected vertical master or review copy.",
                severity="critical",
            )
        )
    if audio is None:
        values.append(
            finding(
                "render_audio_missing", "The rendered MP4 has no audio stream.", severity="critical"
            )
        )
    duration = float(media.get("format", {}).get("duration", 0))
    expected = timeline_duration(snapshot["scenes"], snapshot["settings"]["fps"])
    if not math.isfinite(duration) or not 0 < duration <= 181:
        raise ValueError("The rendered duration is invalid or exceeds the episode limit.")
    if abs(duration - expected) > 0.2:
        values.append(
            finding(
                "render_duration",
                "Rendered duration does not match this saved timeline.",
                severity="critical",
            )
        )
    if video is None or audio is None:
        return values
    scan = subprocess.run(
        [
            config.ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-nostats",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-i",
            str(path),
            "-t",
            "180",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0",
            "-vf",
            "blackdetect=d=0.4:pix_th=0.10:pic_th=0.98",
            "-af",
            "silencedetect=noise=-50dB:d=0.8,astats=metadata=0:reset=0",
            "-threads",
            "2",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if scan.returncode:
        raise ValueError("The rendered MP4 did not decode cleanly. Render a fresh review copy.")
    for left, right in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", scan.stderr):
        values.append(
            finding(
                "black_interval",
                f"Nearly black video from {float(left):.2f}s to {float(right):.2f}s. Check whether the pause or artwork is intentional.",
                float(left),
            )
        )
    silence = None
    for match in re.finditer(r"silence_(start|end): ([\d.]+)", scan.stderr):
        kind, stamp = match.groups()
        if kind == "start":
            silence = float(stamp)
        elif silence is not None:
            values.append(
                finding(
                    "silent_interval",
                    f"Nearly silent mix from {silence:.2f}s to {float(stamp):.2f}s. Check narration and intentional pauses.",
                    silence,
                )
            )
            silence = None
    if silence is not None and duration - silence >= 0.8:
        values.append(
            finding(
                "silent_interval",
                f"The mix is nearly silent from {silence:.2f}s to the end. Check the ending.",
                silence,
            )
        )
    peaks = [float(v) for v in re.findall(r"Peak level dB: (-?(?:\d+(?:\.\d+)?|inf))", scan.stderr)]
    if peaks and max(peaks) >= -0.1:
        values.append(
            finding(
                "mix_peak",
                "The rendered mix reaches almost 0 dBFS. Listen for distortion and lower levels if needed.",
            )
        )
    return values[:30]


def source_findings(project_id, request, db):
    # A failed attempt can be retried; it is not an unrepairable approval blocker.
    values = review_queue(project_id, request, db)["findings"]
    for value in values:
        if value["code"] == "render_failed":
            value["severity"] = "warning"
    return values


@router.get("/projects/{project_id}/finish-check")
def check(project_id: str, request: Request, db=Depends(session)):
    project = get_project(db, project_id)
    revision = project.revision
    values = source_findings(project_id, request, db)
    # Section previews and old revisions cannot stand in for a full-episode check.
    jobs = db.scalars(
        select(RenderJob)
        .where(
            RenderJob.project_id == project_id,
            RenderJob.project_revision == revision,
            RenderJob.status == "completed",
        )
        .order_by(RenderJob.created_at.desc())
        .limit(100)
    )
    candidate = next(
        (
            j
            for j in jobs
            if not j.snapshot.get("section") and not j.snapshot.get("proposal_id") and j.output_key
        ),
        None,
    )
    scanned = None
    if candidate:
        try:
            values += scan_render(
                request.app.state.storage.path(candidate.output_key),
                request.app.state.settings,
                candidate.snapshot,
            )
            scanned = candidate.id
        except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError):
            values.append(
                finding(
                    "render_scan_unavailable",
                    "Could not finish the rendered-video scan. Render a new full review copy and check again.",
                )
            )
    else:
        values.append(
            finding(
                "full_review_needed",
                "No completed full-video render exists for this revision. Render a review copy to check black frames, silence and mix peaks.",
            )
        )
    if project.settings.get("voice_volume", 1) == 0:
        values.append(
            finding(
                "voice_muted",
                "Narration volume is zero. Confirm this is intentional before export.",
            )
        )
    # A concurrent edit may finish while FFmpeg is scanning; never label old results as current.
    db.expire(project)
    if project.revision != revision:
        raise HTTPException(409, "The video changed during checks. Run Check and export again.")
    return {
        "revision": revision,
        "findings": values,
        "critical": sum(v["severity"] == "critical" for v in values),
        "scanned_render_id": scanned,
        "limits": "Checks cover saved sources and, when available, the actual full rendered MP4. Black/silent intervals and near-zero peaks are review warnings, not proof of mistakes. Caption/artwork legibility, story meaning and comedy still need your review.",
    }


class FinishInput(RevisionInput):
    reviewed: Literal[True]


@router.post("/projects/{project_id}/finish-export", status_code=202)
def export(project_id: str, data: FinishInput, request: Request, db=Depends(session)):
    with request.app.state.render_lock:
        project = locked_project(db, project_id, data.base_revision)
        critical = [
            v for v in source_findings(project_id, request, db) if v["severity"] == "critical"
        ]
        if critical:
            raise HTTPException(
                422,
                "Fix the blocking review items before exporting: "
                + "; ".join(v["message"] for v in critical[:3]),
            )
        # The creator explicitly approved this exact saved edit. Do not advance its revision:
        # its reviewed full-video render and the final snapshot represent the same content.
        project.script_approved = True
        project.autopilot = {**(project.autopilot or {}), "voice_approved": True}
        job = queue_render(project_id, request, db)
        return {"project": project_dict(project, db, True), "job": job}
