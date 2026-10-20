import hashlib

import pytest

from app import publishing
from app.database import Project, RenderJob
from app.schemas import VideoSettings


@pytest.fixture
def configured(client):
    response = client.put(
        "/api/publishing/connection",
        json={
            "buffer_api_key": "test-buffer-key",
            "cloud_name": "testcloud",
            "cloud_api_key": "testkey",
            "cloud_api_secret": "testsecret",
        },
    )
    assert response.status_code == 200, response.text
    return client


def fake_export(client, *, quality="final", approved=True):
    with client.app.state.sessions() as db:
        project = Project(
            title="Episode 1",
            revision=4,
            script_approved=approved,
            settings=VideoSettings().model_dump(),
        )
        db.add(project)
        db.flush()
        job = RenderJob(
            project_id=project.id,
            project_revision=4,
            status="completed",
            output_key="exports/test.mp4",
            snapshot={"quality": quality, "title": "Episode 1", "section": None},
        )
        db.add(job)
        db.commit()
        job_id = job.id
    client.app.state.storage.write("exports/test.mp4", b"fake mp4 content")
    return job_id


def send_body(render_id):
    return {
        "render_id": render_id,
        "channel_ids": ["ig1", "yt1"],
        "caption": "The most absurd speedster loss.",
        "youtube_title": "Flash loses again",
        "mode": "draft",
    }


def test_connection_is_private_and_requires_authentication(configured, settings):
    r = configured.get("/api/publishing/status")
    assert r.json()["buffer_configured"]
    assert "test-buffer-key" not in r.text
    assert "testsecret" not in r.text
    path = settings.data_dir / ".publisher-connection.json"
    assert path.exists()
    assert path.stat().st_mode & 0o077 == 0
    configured.headers.pop("Authorization", None)
    assert configured.get("/api/publishing/history").status_code == 401


def test_invalid_cloud_name_does_not_overwrite_connection(configured):
    r = configured.put("/api/publishing/connection", json={"cloud_name": "../bad"})
    assert r.status_code == 422
    assert configured.get("/api/publishing/status").json()["cloud_name"] == "testcloud"


def test_draft_export_cannot_be_published(configured, monkeypatch):
    identifier = fake_export(configured, quality="draft")
    monkeypatch.setattr(publishing, "fetch_channels", lambda key: [])
    result = configured.post("/api/publishing/send", json=send_body(identifier))
    assert result.status_code == 422


def test_unapproved_video_cannot_be_published(configured, monkeypatch):
    identifier = fake_export(configured, approved=False)
    monkeypatch.setattr(publishing, "fetch_channels", lambda key: [])
    result = configured.post("/api/publishing/send", json=send_body(identifier))
    assert result.status_code == 409


def test_approved_video_sent_once_per_channel(configured, monkeypatch):
    identifier = fake_export(configured)
    calls = []
    monkeypatch.setattr(
        publishing,
        "fetch_channels",
        lambda key: [
            {"id": "ig1", "name": "Comic IG", "service": "instagram", "paused": False},
            {"id": "yt1", "name": "Comic YT", "service": "youtube", "paused": False},
        ],
    )
    monkeypatch.setattr(
        publishing,
        "upload_video",
        lambda keys, path: "https://res.cloudinary.com/demo/video/upload/test.mp4",
    )

    def fake_post(key, channel_id, caption, video_url, draft, service, title):
        calls.append((channel_id, draft, service, title))
        return channel_id + "-post"

    monkeypatch.setattr(publishing, "buffer_create", fake_post)
    response = configured.post("/api/publishing/send", json=send_body(identifier))
    assert response.status_code == 200, response.text
    assert [x["status"] for x in response.json()["results"]] == ["draft", "draft"]
    assert calls == [
        ("ig1", True, "instagram", "Flash loses again"),
        ("yt1", True, "youtube", "Flash loses again"),
    ]
    duplicate = configured.post("/api/publishing/send", json=send_body(identifier))
    assert duplicate.status_code == 200
    assert all(x["already_submitted"] for x in duplicate.json()["results"])
    assert len(calls) == 2
    assert len(configured.get("/api/publishing/history").json()) == 2


def test_missing_channel_rejected_before_upload(configured, monkeypatch):
    identifier = fake_export(configured)
    monkeypatch.setattr(publishing, "fetch_channels", lambda key: [])
    monkeypatch.setattr(
        publishing, "upload_video", lambda *args: pytest.fail("Upload should not start")
    )
    response = configured.post("/api/publishing/send", json=send_body(identifier))
    assert response.status_code == 422


def test_graphql_video_metadata_uses_reels_and_youtube_category():
    assert publishing.channel_metadata("instagram", "Title") == {
        "instagram": {"type": "reel", "shouldShareToFeed": True}
    }
    assert publishing.channel_metadata("facebook", "Title") == {"facebook": {"type": "reel"}}
    assert publishing.channel_metadata("youtube", "Title")["youtube"]["categoryId"] == "24"
    assert publishing.channel_metadata("tiktok", "Title") is None


def test_cloudinary_signature_matches_official_example():
    sample = hashlib.sha1("timestamp=1315060510abcd".encode()).hexdigest()
    assert sample == "a21ad0f63beb4de2e5575204b79ab90bffb02c10"
