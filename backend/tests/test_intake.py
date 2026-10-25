"""M1 source intake contracts. Generated artwork/audio, no copyrighted fixtures."""

import hashlib
import io
import time
from threading import Event

import pytest
from conftest import add_project, wav_bytes
from PIL import Image
from test_automation import fixture_project
from test_director import enable, wait_job

from app.database import RenderJob
from app.renderer import probe
from app.schemas import VisionConnection
from app.verdict_provider import connection_status, save_connection


def upload(client, url, filename, raw, kind="auto"):
    return client.post(url + "/import-file", files={"file": (filename, raw)}, data={"kind": kind})


def test_optional_script_import_preserves_history_and_never_approves_or_synthesizes_voice(client):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    response = upload(
        client, url, "approved.md", b"\xef\xbb\xbfAzure throws the punch.\nSlate reacts."
    )
    assert response.status_code == 201, response.text
    saved = response.json()["project"]
    assert saved["script"] == "Azure throws the punch.\nSlate reacts."
    assert not saved["script_approved"] and saved["narration_url"] is None
    ready = client.get(url + "/intake-readiness").json()
    assert not ready["ready"]
    assert any(c["code"] == "narration" and c["state"] == "blocking" for c in ready["checks"])
    assert client.get(url + "/director").json() == []
    restored = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert restored["script"] == project["script"] and restored["narration_url"] is None
    for filename, raw in [
        ("bad.txt", b"\xff\xfe"),
        ("empty.md", b"   "),
        ("nul.txt", b"hi\0there"),
        ("long.txt", b"x" * 20_001),
        ("fake.png", b"script"),
    ]:
        before = client.get(url).json()
        rejected = upload(client, url, filename, raw, "script")
        assert rejected.status_code == 422, rejected.text
        assert client.get(url).json()["revision"] == before["revision"]


def test_readiness_is_read_only_and_reports_sources_duplicates_staleness_and_optional_risks(
    client, image_bytes
):
    project, url, first, _ = fixture_project(client, image_bytes)
    # This fixture intentionally contains the same original generated image twice.
    before = client.get(url).json()
    result = client.get(
        url + "/intake-readiness", params={"base_revision": project["revision"]}
    ).json()
    assert result["ready"] and result["panel_count"] == 2
    assert any(c["code"] == "duplicate_artwork" for c in result["checks"])
    assert client.get(url).json() == before
    stale = client.get(
        url + "/intake-readiness", params={"base_revision": project["revision"] - 1}
    ).json()
    assert not stale["ready"] and any(c["code"] == "stale_revision" for c in stale["checks"])
    changed = upload(
        client, url, "different.txt", b"Completely unrelated recording about sandwiches"
    ).json()["project"]
    result = client.get(url + "/intake-readiness").json()
    assert any(c["code"] == "script_caption_mismatch" and c["confirm"] for c in result["checks"])
    client.app.state.storage.path(first["image_url"].removeprefix("/api/media/")).unlink()
    result = client.get(url + "/intake-readiness").json()
    assert not result["ready"] and any(c["code"] == "missing_assets" for c in result["checks"])
    assert client.get(url).json()["revision"] == changed["revision"]


def test_vision_eligibility_never_calls_provider_or_silently_downgrades(
    client, image_bytes, monkeypatch
):
    _, url, _, _ = fixture_project(client, image_bytes)

    def forbidden(*args, **kwargs):
        pytest.fail("Readiness must not upload anything or contact any external provider")

    monkeypatch.setattr("app.verdict_provider.httpx.post", forbidden)
    missing = client.get(url + "/intake-readiness?mode=vision").json()
    assert not missing["ready"] and any(
        c["code"] == "vision" and c["state"] == "blocking" for c in missing["checks"]
    )
    basic = client.get(url + "/intake-readiness?mode=basic").json()
    assert basic["ready"] and any("does not understand" in c["message"] for c in basic["checks"])


def test_vision_authorization_is_bound_to_endpoint_and_not_to_secret(
    client, settings, image_bytes, monkeypatch
):
    project, url, _, _ = fixture_project(client, image_bytes)
    save_connection(
        settings,
        VisionConnection(base_url="https://one.example/v1", model="vision", api_key="secret-one"),
    )
    status = connection_status(settings)
    save_connection(
        settings,
        VisionConnection(base_url="https://one.example/v1", model="vision", api_key="secret-two"),
    )
    assert connection_status(settings)["authorization_id"] == status["authorization_id"]
    assert "secret" not in str(client.get("/api/verdict/connection").json())
    project = enable(client, project, mode="vision")
    denied = client.post(
        url + "/director",
        json={"base_revision": project["revision"], "vision_connection": "0" * 64},
    )
    assert denied.status_code == 409 and client.get(url + "/director").json() == []
    entered, release = Event(), Event()

    def waiting(*args):
        entered.set()
        assert release.wait(10)
        return {"pauses": []}

    monkeypatch.setattr("app.director.analyze_audio", waiting)

    def forbidden(*args, **kwargs):
        pytest.fail("A changed provider must not inherit authorization to receive artwork")

    monkeypatch.setattr("app.verdict_provider.httpx.post", forbidden)
    response = client.post(
        url + "/director",
        json={
            "base_revision": project["revision"],
            "vision_connection": status["authorization_id"],
        },
    )
    assert response.status_code == 202, response.text
    assert entered.wait(10)
    save_connection(
        settings,
        VisionConnection(base_url="https://two.example/v1", model="vision", api_key="new-secret"),
    )
    release.set()
    failed = wait_job(client, url)
    assert failed["status"] == "failed" and "changed" in failed["message"]
    assert client.get(url).json()["revision"] == project["revision"]


def test_rejected_archive_and_upload_limit_do_not_change_saved_inputs(
    client, image_bytes, settings
):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    panel = upload(client, url, "original.png", image_bytes).json()["project"]
    assert upload(client, url, "unsupported.zip", b"not an authorized CBZ").status_code == 422
    assert client.get(url).json()["revision"] == panel["revision"]
    settings.max_upload_bytes = 1024
    assert upload(client, url, "oversize.wav", b"x" * 1025, "narration").status_code == 413
    assert client.get(url).json()["revision"] == panel["revision"]
    assert client.get(url).json()["workflow"]["panel_ids"] == panel["workflow"]["panel_ids"]


@pytest.mark.render
def test_three_original_panels_and_75_second_recording_create_full_review_preview(
    client, monkeypatch
):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    for index, color in enumerate(["#134751", "#381b64", "#76511c"]):
        data = io.BytesIO()
        Image.new("RGB", (320, 480), color).save(data, "PNG")
        response = upload(client, url, f"original-{index}.png", data.getvalue())
        assert response.status_code == 201, response.text
    assert upload(client, url, "voice.wav", wav_bytes(75)).status_code == 201
    script = "Azure hits Slate. Slate reveals the trick. Azure reacts."
    assert upload(client, url, "reviewed.txt", script.encode()).status_code == 201
    srt = b"1\n00:00:00,000 --> 00:00:25,000\nAzure hits Slate.\n\n2\n00:00:25,000 --> 00:00:50,000\nSlate reveals the trick.\n\n3\n00:00:50,000 --> 00:01:15,000\nAzure reacts.\n"
    assert upload(client, url, "captions.srt", srt).status_code == 201
    project = client.get(url).json()
    ready = client.get(
        url + "/intake-readiness", params={"base_revision": project["revision"]}
    ).json()
    assert ready["ready"] and not any(c["confirm"] for c in ready["checks"])
    keys = [p["image_url"].removeprefix("/api/media/") for p in client.get("/api/panels").json()]
    keys.append(project["narration_url"].removeprefix("/api/media/"))
    original_hashes = {
        key: hashlib.sha256(client.app.state.storage.path(key).read_bytes()).hexdigest()
        for key in keys
    }

    def forbidden(*args, **kwargs):
        pytest.fail("Basic preview must not call vision, speech, Cloudinary or Buffer")

    monkeypatch.setattr("app.verdict_provider.httpx.post", forbidden)
    project = enable(client, project, delivery="draft", pace="fast")
    created = client.post(url + "/director", json={"base_revision": project["revision"]})
    assert created.status_code == 202, created.text
    deadline = time.monotonic() + 240
    while time.monotonic() < deadline:
        client.app.state.director.sync_renders()
        job = client.get(url + "/director").json()[0]
        if job["status"] not in ("queued", "working", "rendering"):
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    assert len(client.get(url + "/director").json()) == 1
    assert job["render"]["quality"] == "draft"
    with client.app.state.sessions() as db:
        render = db.get(RenderJob, job["render"]["id"])
        media = probe(client.app.state.storage.path(render.output_key), client.app.state.settings)
    video = next(s for s in media["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (360, 640)
    assert any(s["codec_type"] == "audio" and s["codec_name"] == "aac" for s in media["streams"])
    assert abs(media["duration"] - 75) < 0.1
    saved = client.get(url).json()
    assert abs(saved["duration"] - 75) < 0.05 and saved["narration_duration"] == 75
    assert saved["script"] == script and len(saved["caption_cues"]) == 3
    assert not saved["script_approved"]
    assert all(
        hashlib.sha256(client.app.state.storage.path(key).read_bytes()).hexdigest() == digest
        for key, digest in original_hashes.items()
    )
    undo = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert undo["scene_count"] == 0 and undo["narration_duration"] == 75
