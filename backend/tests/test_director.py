"""Original generated panels/audio only; provider calls are mocked, rendering is real."""

import json
import time
from threading import Event

import httpx
import pytest
from conftest import add_project, wav_bytes
from test_automation import fixture_project
from test_workflow import payload

from app.database import DirectorJob, RenderJob
from app.director import focus_position
from app.renderer import probe
from app.schemas import VisionConnection
from app.verdict_provider import VisionDirector, connection_path, save_connection


def enable(client, project, **options):
    response = client.put(
        f"/api/projects/{project['id']}/autopilot",
        json={"base_revision": project["revision"], "enabled": True, **options},
    )
    assert response.status_code == 200, response.text
    return response.json()


def wait_job(client, url):
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        client.app.state.director.sync_renders()
        jobs = client.get(url + "/director").json()
        if jobs and jobs[0]["status"] not in ("queued", "working", "rendering"):
            return jobs[0]
        time.sleep(0.1)
    pytest.fail("Verdict did not finish within 120 seconds")


def fake_render(client, monkeypatch):
    def finish(job_id):
        with client.app.state.sessions() as db:
            job = db.get(RenderJob, job_id)
            job.status, job.progress = "completed", 100
            db.commit()

    monkeypatch.setattr(client.app.state.renderer, "enqueue", finish)


def start(client, url, project):
    response = client.post(url + "/director", json={"base_revision": project["revision"]})
    assert response.status_code == 202, response.text
    return response.json()


def test_panels_and_voice_to_real_vertical_preview_then_final(client, image_bytes):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    for filename, raw, kind in [
        ("original.png", image_bytes, "panels"),
        ("voice.wav", wav_bytes(1.5), "narration"),
    ]:
        response = client.post(
            url + "/import-file", files={"file": (filename, raw)}, data={"kind": kind}
        )
        assert response.status_code == 201, response.text
        project = response.json()["project"]
    project = enable(client, project)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    assert result["report"]["mode"] == "basic"
    assert result["report"]["warnings"]
    draft = client.get(url).json()
    assert draft["scene_count"] >= 2
    assert not draft["script_approved"] and not draft["settings"]["captions"]
    assert draft["duration"] >= 1.5
    render = result["render"]
    assert render["quality"] == "draft"
    with client.app.state.sessions() as db:
        rendered = db.get(RenderJob, render["id"])
        data = probe(client.app.state.storage.path(rendered.output_key), client.app.state.settings)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (360, 640)
    approval = client.post(url + "/director/approve", json={"base_revision": draft["revision"]})
    assert approval.status_code == 200, approval.text
    final_id = approval.json()["id"]
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        renders = client.get("/api/renders", params={"project_id": project["id"]}).json()
        final = next(j for j in renders if j["id"] == final_id)
        if final["status"] in ("completed", "failed"):
            break
        time.sleep(0.1)
    assert final["status"] == "completed", final
    with client.app.state.sessions() as db:
        rendered = db.get(RenderJob, final_id)
        data = probe(client.app.state.storage.path(rendered.output_key), client.app.state.settings)
    video = next(s for s in data["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    assert client.get(final["download_url"]).status_code == 200
    completed = wait_job(client, url)
    assert completed["render"]["id"] == final_id and completed["render"]["quality"] == "final"
    approved = client.get(url).json()
    assert approved["autopilot"]["voice_approved"]
    changed = client.put(url + "/workspace", json=payload(approved, title="Changed")).json()
    assert not changed["script_approved"] and not changed["autopilot"]["voice_approved"]
    assert (
        client.post(
            url + "/director/approve", json={"base_revision": changed["revision"]}
        ).status_code
        == 422
    )
    # Undo restores the project before Verdict, including the zero-scene timeline.
    reverted = client.post(
        url + "/history/undo", json={"base_revision": changed["revision"]}
    ).json()
    reverted = client.post(
        url + "/history/undo", json={"base_revision": reverted["revision"]}
    ).json()
    assert reverted["scene_count"] == 0 and reverted["narration_url"]
    assert any(
        v["name"] == "Before Verdict Autopilot" for v in client.get(url + "/versions").json()
    )


def test_finish_for_me_is_explicit_and_keeps_locked_shots(client, image_bytes, monkeypatch):
    project, url, _, _ = fixture_project(client, image_bytes)
    shots = payload(project)["scenes"]
    shots[0].update(locked=True, motion="pan_down", focus_y=0.8)
    project = client.put(url + "/workspace", json=payload(project, scenes=shots)).json()
    project = enable(client, project, delivery="final")
    fake_render(client, monkeypatch)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    saved = client.get(url).json()
    assert saved["script_approved"] and saved["autopilot"]["voice_approved"]
    assert saved["scenes"][0]["locked"] and saved["scenes"][0]["focus_y"] == 0.8
    assert result["render"]["quality"] == "final"
    assert saved["script"] == project["script"]
    assert saved["caption_cues"] == project["caption_cues"]


def test_concurrent_edit_is_never_overwritten_and_duplicate_run_blocked(
    client, image_bytes, monkeypatch
):
    project, url, _, _ = fixture_project(client, image_bytes)
    project = enable(client, project)
    entered, release = Event(), Event()
    from app import director

    original = director.analyze_audio

    def blocked(*args):
        entered.set()
        assert release.wait(10)
        return original(*args)

    monkeypatch.setattr(director, "analyze_audio", blocked)
    start(client, url, project)
    assert entered.wait(10)
    assert (
        client.post(url + "/director", json={"base_revision": project["revision"]}).status_code
        == 409
    )
    changed = client.put(url + "/workspace", json=payload(project, title="My new edit")).json()
    release.set()
    result = wait_job(client, url)
    assert result["status"] == "failed" and "changed" in result["message"]
    assert client.get(url).json()["revision"] == changed["revision"]
    assert client.get(url).json()["title"] == "My new edit"
    assert not result["render"]


def test_cancel_before_apply_preserves_original(client, image_bytes, monkeypatch):
    project, url, _, _ = fixture_project(client, image_bytes)
    project = enable(client, project)
    entered, release = Event(), Event()
    from app import director

    def blocked(*args):
        entered.set()
        assert release.wait(10)
        return {"pauses": []}

    monkeypatch.setattr(director, "analyze_audio", blocked)
    job = start(client, url, project)
    assert entered.wait(10)
    cancelled = client.post(url + "/director/" + job["id"] + "/cancel", json={})
    assert cancelled.status_code == 200
    release.set()
    client.app.state.director.executor.submit(lambda: None).result(timeout=10)
    assert client.get(url).json()["revision"] == project["revision"]
    assert wait_job(client, url)["status"] == "cancelled"


def test_prerequisites_and_connection_secret_storage(client, settings):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    assert (
        client.post(url + "/director", json={"base_revision": project["revision"]}).status_code
        == 422
    )
    project = enable(client, project, mode="vision")
    assert (
        client.post(url + "/director", json={"base_revision": project["revision"]}).status_code
        == 422
    )
    secret = "only-for-test-not-a-real-key"
    response = client.put(
        "/api/verdict/connection",
        json={"base_url": "https://example.com/v1", "model": "test-vision", "api_key": secret},
    )
    assert response.status_code == 200 and secret not in response.text
    assert secret not in client.get("/api/verdict/connection").text
    assert secret in connection_path(settings).read_text()
    assert client.get("/api/media/.verdict-provider.json").status_code in (400, 404)
    response = client.put(
        "/api/verdict/connection",
        json={"base_url": "https://example.com/v1", "model": "test-vision-2"},
    )
    assert response.json()["has_key"]
    response = client.put(
        "/api/verdict/connection",
        json={"base_url": "https://other.example/v1", "model": "test-vision"},
    )
    assert not response.json()["has_key"]
    assert (
        client.put(
            "/api/verdict/connection",
            json={"base_url": "http://remote.example/v1", "model": "test"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/api/verdict/connection",
            json={"base_url": "http://localhost:11434/v1", "model": "local"},
        ).status_code
        == 200
    )
    assert client.delete("/api/verdict/connection").status_code == 200
    assert not connection_path(settings).exists()


def mock_vision(monkeypatch, panel_id, invalid=False, confidence=None):
    def post(url, **kwargs):
        content = kwargs["json"]["messages"][1]["content"]
        assert any(c["type"] == "image_url" for c in content)
        cards = json.loads(content[0]["text"])["narration_cards"]
        assignments = [
            {
                "panel_id": "invented" if invalid else panel_id,
                "beat": "hit",
                "target_x": 0.8,
                "target_y": 0.3,
                "framing": "fill",
                "reason": "Fist at the right edge",
                **({"confidence": confidence} if confidence is not None else {}),
            }
            for _ in cards
        ]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {"assignments": assignments, "summary": "Matched the impact."}
                            )
                        }
                    }
                ]
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr("app.verdict_provider.httpx.post", post)


def test_vision_uses_images_and_validates_provider_plan(client, image_bytes, monkeypatch, settings):
    project, url, _, second = fixture_project(client, image_bytes)
    save_connection(
        settings,
        VisionConnection(base_url="https://example.com/v1", model="test", api_key="private"),
    )
    project = enable(client, project, mode="vision")
    mock_vision(monkeypatch, second["id"])
    fake_render(client, monkeypatch)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    saved = client.get(url).json()
    assert all(s["panel_id"] == second["id"] for s in saved["scenes"])
    assert result["report"]["mode"] == "vision"
    assert "private" not in json.dumps(result)
    assert saved["scenes"][0]["focus_x"] > 0.5
    assert saved["workflow"]["storyboard"][0]["panel_id"] == second["id"]
    assert result["report"]["smart_crops"]
    assert result["report"]["smart_crops"][0]["reason"] == "Fist at the right edge"
    assert result["report"]["smart_crops"][0]["review_required"]
    # A hallucinated panel must never reach the timeline.
    mock_vision(monkeypatch, second["id"], invalid=True)
    before = saved["revision"]
    start(client, url, saved)
    result = wait_job(client, url)
    assert result["status"] == "failed" and "usable panel plan" in result["message"]
    assert client.get(url).json()["revision"] == before


def test_uncertain_vision_crop_uses_safe_framing_and_is_reviewable(
    client, image_bytes, monkeypatch, settings
):
    project, url, _, second = fixture_project(client, image_bytes)
    save_connection(
        settings,
        VisionConnection(base_url="https://example.com/v1", model="test", api_key="secret"),
    )
    project = enable(client, project, mode="vision")
    mock_vision(monkeypatch, second["id"], confidence=0.2)
    fake_render(client, monkeypatch)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    assert any("uncertain" in warning for warning in result["report"]["warnings"])
    reviews = result["report"]["smart_crops"]
    assert reviews
    assert all(review["review_required"] and not review["applied"] for review in reviews)
    saved = client.get(url).json()
    assert all(scene["framing"] == "fit" for scene in saved["scenes"])
    assert all(scene["focus_x"] == 0.5 for scene in saved["scenes"])


def test_vision_rejects_invalid_model_confidence(
    client, image_bytes, monkeypatch, settings
):
    project, url, _, second = fixture_project(client, image_bytes)
    save_connection(
        settings,
        VisionConnection(base_url="https://example.com/v1", model="test"),
    )
    project = enable(client, project, mode="vision")
    mock_vision(monkeypatch, second["id"], confidence=4.2)
    fake_render(client, monkeypatch)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "failed"
    assert client.get(url).json()["revision"] == project["revision"]


def test_provider_failure_is_redacted_and_does_not_fallback_silently(
    client, image_bytes, monkeypatch, settings
):
    project, url, _, _ = fixture_project(client, image_bytes)
    save_connection(
        settings,
        VisionConnection(base_url="https://example.com/v1", model="test", api_key="super-secret"),
    )
    project = enable(client, project, mode="vision")

    def denied(url, **kwargs):
        return httpx.Response(401, text="super-secret", request=httpx.Request("POST", url))

    monkeypatch.setattr("app.verdict_provider.httpx.post", denied)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "failed" and "super-secret" not in json.dumps(result)
    assert client.get(url).json()["revision"] == project["revision"]


def test_focus_centering_math():
    assert focus_position(0.8, 2) == pytest.approx(0.9173913043)
    assert focus_position(0.2, 2) < 0.5
    assert focus_position(0.2, 0.4) == 0.5


def test_remote_speech_segments_become_ordered_captions(settings, tmp_path, monkeypatch):
    voice = tmp_path / "original.wav"
    voice.write_bytes(wav_bytes(1.5))

    def post(url, **kwargs):
        assert url.endswith("/audio/transcriptions")
        assert kwargs["files"]["file"][0] == "narration.mp3"
        return httpx.Response(
            200,
            json={
                "segments": [{"start": 0, "end": 1.5, "text": "Azure punches Slate hard right now"}]
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr("app.verdict_provider.httpx.post", post)
    provider = VisionDirector(
        VisionConnection(
            base_url="https://example.com/v1", model="vision", transcription_model="speech"
        )
    )
    cues = provider.transcribe(voice, settings)
    assert len(cues) == 2 and cues[0]["end"] == cues[1]["start"] and cues[-1]["end"] == 1.5


def test_restart_marks_interrupted_planning_and_recovers_rendering(client):
    project = add_project(client)
    with client.app.state.sessions() as db:
        waiting = DirectorJob(
            project_id=project["id"], base_revision=1, status="working", snapshot={}
        )
        render = RenderJob(
            project_id=project["id"],
            project_revision=1,
            snapshot={"quality": "draft"},
            status="completed",
        )
        db.add_all([waiting, render])
        db.flush()
        finished = DirectorJob(
            project_id=project["id"],
            base_revision=1,
            status="rendering",
            snapshot={},
            render_id=render.id,
        )
        db.add(finished)
        db.commit()
        job_id, finished_id = waiting.id, finished.id
    # Same recovery logic used at startup, without starting a second monitor.
    from app.director import DirectorService

    service = DirectorService(client.app.state)
    service.start()
    service.stop()
    with client.app.state.sessions() as db:
        assert db.get(DirectorJob, job_id).status == "failed"
        assert db.get(DirectorJob, finished_id).status == "completed"


def test_basic_recognizes_speech_without_using_saved_remote_provider(
    client, image_bytes, monkeypatch, settings
):
    project, url, _, _ = fixture_project(client, image_bytes)
    project = client.put(url + "/workspace", json=payload(project, cues=[], script="")).json()
    project = enable(client, project)
    save_connection(
        settings,
        VisionConnection(
            base_url="https://example.com/v1", model="vision", transcription_model="speech"
        ),
    )

    def forbidden(*args, **kwargs):
        pytest.fail("Basic mode must never send panels or audio to a provider")

    monkeypatch.setattr("app.verdict_provider.httpx.post", forbidden)
    cues = [
        {"start": 0, "end": 2.5, "text": "Azure punches hard"},
        {"start": 3, "end": 6, "text": "Slate reveals a surprise"},
    ]
    monkeypatch.setattr("app.director.transcribe", lambda *args: cues)
    fake_render(client, monkeypatch)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    saved = client.get(url).json()
    assert saved["caption_cues"] == cues and saved["settings"]["captions"]
    assert saved["script"] == "Azure punches hard Slate reveals a surprise"
    assert not saved["script_approved"]
