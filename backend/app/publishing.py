"""Approved export -> Cloudinary video -> Buffer channel queue.

No background auto-posts, hidden OAuth, or scraping. Connections are explicitly
configured by the studio operator. Credentials never reach the browser again.
"""

import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from .database import Project, RenderJob

router = APIRouter(prefix="/api/publishing", tags=["publishing"])
LOCK = Lock()
SUPPORTED = {"facebook", "instagram", "tiktok", "youtube"}
BUFFER_URL = "https://api.buffer.com"
BUFFER_ORGS = "query { account { organizations { id } } }"
BUFFER_CHANNELS = """query GetChannels($id: OrganizationId!) {
  channels(input: { organizationId: $id }) {
    id name displayName service isQueuePaused
  }
}"""
BUFFER_CREATE = """mutation CreateVideoPost(
  $channelId: ChannelId!, $text: String!, $url: String!,
  $draft: Boolean!, $metadata: PostInputMetaData
) {
  createPost(input: {
    channelId: $channelId
    text: $text
    schedulingType: automatic
    mode: addToQueue
    saveToDraft: $draft
    needsApproval: false
    assets: [{video: {url: $url}}]
    metadata: $metadata
  }) {
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}"""


class ConnectionInput(BaseModel):
    buffer_api_key: str = Field(default="", max_length=1000)
    cloud_name: str = Field(default="", max_length=150)
    cloud_api_key: str = Field(default="", max_length=200)
    cloud_api_secret: str = Field(default="", max_length=400)


class PublishInput(BaseModel):
    render_id: str
    channel_ids: list[str] = Field(min_length=1, max_length=4)
    caption: str = Field(min_length=1, max_length=2200)
    youtube_title: str = Field(default="", max_length=100)
    mode: str = Field(pattern="^(draft|queue)$")


def private_path(request: Request, name: str) -> Path:
    return request.app.state.settings.data_dir / name


def read_json(path: Path, fallback: dict) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else fallback
    except (OSError, ValueError):
        return fallback


def atomic_json(path: Path, data: dict) -> None:
    fd, filename = tempfile.mkstemp(prefix=".cb-publish-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False)
        os.chmod(filename, 0o600)
        os.replace(filename, path)
    finally:
        Path(filename).unlink(missing_ok=True)


def connection(request: Request) -> dict:
    return read_json(private_path(request, ".publisher-connection.json"), {})


def state(request: Request) -> dict:
    return read_json(
        private_path(request, ".publisher-history.json"), {"media": {}, "attempts": {}}
    )


def connection_status(settings: dict) -> dict:
    return {
        "buffer_configured": bool(settings.get("buffer_api_key")),
        "cloudinary_configured": all(
            settings.get(key) for key in ("cloud_name", "cloud_api_key", "cloud_api_secret")
        ),
        "cloud_name": settings.get("cloud_name", ""),
    }


@router.get("/status")
def get_status(request: Request):
    return connection_status(connection(request))


@router.put("/connection")
def save_connection(body: ConnectionInput, request: Request):
    with LOCK:
        values = connection(request)
        for key, value in body.model_dump().items():
            if value.strip():
                values[key] = value.strip()
        if values.get("cloud_name") and not re.fullmatch(
            r"[A-Za-z0-9_-]{1,150}", values["cloud_name"]
        ):
            raise HTTPException(422, "Invalid Cloudinary cloud name")
        atomic_json(private_path(request, ".publisher-connection.json"), values)
    return connection_status(values)


@router.delete("/connection")
def clear_connection(request: Request):
    with LOCK:
        private_path(request, ".publisher-connection.json").unlink(missing_ok=True)
    return connection_status({})


def buffer_query(key: str, query: str, variables: dict | None = None) -> dict:
    try:
        response = httpx.post(
            BUFFER_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"query": query, "variables": variables or {}},
            timeout=30,
            follow_redirects=False,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise RuntimeError("Buffer could not be reached or rejected the request") from error
    if result.get("errors"):
        # GraphQL errors can be detailed and may contain data supplied by the service.
        raise RuntimeError(
            "Buffer rejected this API operation. Check account access and channel permissions."
        )
    return result.get("data") or {}


def fetch_channels(key: str) -> list[dict]:
    orgs = buffer_query(key, BUFFER_ORGS).get("account", {}).get("organizations", [])
    output = []
    for org in orgs[:10]:
        values = buffer_query(key, BUFFER_CHANNELS, {"id": org["id"]}).get("channels") or []
        for ch in values:
            service = str(ch.get("service") or "").lower()
            if service in SUPPORTED:
                output.append(
                    {
                        "id": str(ch["id"]),
                        "service": service,
                        "name": str(ch.get("displayName") or ch.get("name") or service)[:200],
                        "paused": bool(ch.get("isQueuePaused")),
                    }
                )
    return output


@router.get("/channels")
def channels(request: Request):
    settings = connection(request)
    if not settings.get("buffer_api_key"):
        return []
    try:
        return fetch_channels(settings["buffer_api_key"])
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error


@router.get("/history")
def history(request: Request):
    with LOCK:
        records = state(request)
    return list(records.get("attempts", {}).values())[-100:][::-1]


def upload_video(settings: dict, path: Path) -> str:
    if path.stat().st_size > 95 * 1024 * 1024:
        raise ValueError(
            "Video exceeds Cloudinary's single-upload limit. Export a smaller MP4 or configure chunked uploads."
        )
    cloud = settings["cloud_name"]
    timestamp = str(int(time.time()))
    signature = hashlib.sha1(
        f"timestamp={timestamp}{settings['cloud_api_secret']}".encode()
    ).hexdigest()
    try:
        with path.open("rb") as stream:
            response = httpx.post(
                f"https://api.cloudinary.com/v1_1/{cloud}/video/upload",
                data={
                    "api_key": settings["cloud_api_key"],
                    "timestamp": timestamp,
                    "signature": signature,
                },
                files={"file": (path.name, stream, "video/mp4")},
                timeout=300,
                follow_redirects=False,
            )
        response.raise_for_status()
        url = response.json()["secure_url"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as error:
        raise RuntimeError(
            "Cloudinary upload failed; check credentials and video limits"
        ) from error
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != "res.cloudinary.com":
        raise RuntimeError("Cloudinary returned an unexpected media URL")
    return url


def channel_metadata(service: str, title: str) -> dict | None:
    if service == "youtube":
        return {
            "youtube": {
                "title": title,
                "categoryId": "24",  # Entertainment
                "madeForKids": False,
            }
        }
    if service == "instagram":
        return {"instagram": {"type": "reel", "shouldShareToFeed": True}}
    if service == "facebook":
        return {"facebook": {"type": "reel"}}
    return None


def buffer_create(
    key: str, channel_id: str, caption: str, video_url: str, draft: bool, service: str, title: str
) -> str:
    data = (
        buffer_query(
            key,
            BUFFER_CREATE,
            {
                "channelId": channel_id,
                "text": caption,
                "url": video_url,
                "draft": draft,
                "metadata": channel_metadata(service, title),
            },
        ).get("createPost")
        or {}
    )
    if data.get("message"):
        raise ValueError(str(data["message"])[:500])
    identifier = (data.get("post") or {}).get("id")
    if not identifier:
        raise RuntimeError("Buffer returned no post confirmation; inspect Buffer before retrying")
    return str(identifier)


@router.post("/send")
def send(body: PublishInput, request: Request):
    settings = connection(request)
    if not connection_status(settings)["buffer_configured"]:
        raise HTTPException(422, "Connect Buffer first")
    if not connection_status(settings)["cloudinary_configured"]:
        raise HTTPException(422, "Connect Cloudinary to host the video first")
    if len(set(body.channel_ids)) != len(body.channel_ids):
        raise HTTPException(422, "Each channel may be selected only once")
    with request.app.state.sessions() as db:
        job = db.scalar(select(RenderJob).where(RenderJob.id == body.render_id))
        if not job or job.status != "completed" or not job.output_key:
            raise HTTPException(422, "Choose a completed final MP4 export")
        if job.snapshot.get("quality") != "final" or job.snapshot.get("section"):
            raise HTTPException(422, "Only complete final videos can be published")
        project = db.get(Project, job.project_id)
        if not project or not project.script_approved or project.revision != job.project_revision:
            raise HTTPException(409, "The export no longer matches an approved project revision")
        title = body.youtube_title.strip() or project.title.strip()[:100]
        if not title:
            raise HTTPException(422, "YouTube title is required")
        path = request.app.state.storage.public_path(job.output_key)
        if not path.is_file():
            raise HTTPException(404, "Export file is missing")
    if not body.caption.strip():
        raise HTTPException(422, "Write a caption before sending")
    try:
        available = {item["id"]: item for item in fetch_channels(settings["buffer_api_key"])}
    except RuntimeError as error:
        raise HTTPException(502, str(error)) from error
    if any(cid not in available for cid in body.channel_ids):
        raise HTTPException(422, "One or more selected channels are not connected to Buffer")
    # Single-operator studio: serialize sends so two browser tabs cannot post twice.
    with LOCK:
        records = state(request)
        attempts = records.setdefault("attempts", {})
        cached_url = records.setdefault("media", {}).get(body.render_id)
        results = []
        required = [
            cid for cid in body.channel_ids
            if attempts.get(f"{body.render_id}:{cid}", {}).get("status") in (None, "failed")
        ]
        if required and not cached_url:
            try:
                cached_url = upload_video(settings, path)
            except (ValueError, RuntimeError) as error:
                raise HTTPException(502, str(error)) from error
            records["media"][body.render_id] = cached_url
            atomic_json(private_path(request, ".publisher-history.json"), records)
        for cid in body.channel_ids:
            key = f"{body.render_id}:{cid}"
            if key in attempts and attempts[key].get("status") != "failed":
                old = attempts[key]
                results.append({**old, "already_submitted": True})
                continue
            ch = available[cid]
            attempt = {
                "render_id": body.render_id,
                "channel_id": cid,
                "channel": ch["name"],
                "service": ch["service"],
                "status": "submitting",
                "mode": body.mode,
                "post_id": None,
                "message": "",
                "created_at": int(time.time()),
            }
            attempts[key] = attempt
            atomic_json(private_path(request, ".publisher-history.json"), records)
            try:
                post_id = buffer_create(
                    settings["buffer_api_key"],
                    cid,
                    body.caption.strip(),
                    cached_url,
                    body.mode == "draft",
                    ch["service"],
                    title,
                )
                attempt.update(
                    status="draft" if body.mode == "draft" else "queued",
                    post_id=post_id,
                    message="Saved in Buffer"
                    if body.mode == "draft"
                    else "Accepted into Buffer queue",
                )
            except ValueError as error:
                attempt.update(status="failed", message=str(error)[:500])
            except RuntimeError:
                attempt.update(
                    status="uncertain",
                    message="Buffer response could not be confirmed. Inspect Buffer before resubmitting.",
                )
            atomic_json(private_path(request, ".publisher-history.json"), records)
            results.append(dict(attempt))
        return {"results": results, "media_hosted": bool(cached_url)}
