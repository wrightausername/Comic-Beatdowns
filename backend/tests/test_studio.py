import io
import json
import stat
import zipfile

import pytest
from conftest import TOKEN, add_panel, add_project, wav_bytes
from PIL import Image

from app.config import Settings
from app.database import RenderJob
from app.storage import LocalStorage


def test_sign_in_and_protected_media(client, image_bytes):
    panel = add_panel(client, image_bytes)
    client.headers.pop("Authorization")
    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/session").json() == {"authenticated": False}
    assert client.get("/api/projects").status_code == 401
    assert client.get(panel["image_url"]).status_code == 401
    assert client.post("/api/auth/login", json={"token": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"token": "☃"}).status_code == 401
    login = client.post("/api/auth/login", json={"token": TOKEN})
    assert login.status_code == 200
    assert (
        "HttpOnly" in login.headers["set-cookie"]
        and "SameSite=strict" in login.headers["set-cookie"]
    )
    assert client.get(panel["image_url"]).status_code == 200
    assert (
        client.post(
            "/api/projects", json={"title": "CSRF"}, headers={"Origin": "https://evil.example"}
        ).status_code
        == 403
    )
    client.post("/api/auth/logout")
    assert client.get("/api/panels").status_code == 401


def test_generated_token_is_private_and_persistent(tmp_path):
    settings = Settings(data_dir=tmp_path, studio_token="")
    settings.prepare()
    assert len(settings.studio_token) >= 32
    assert stat.S_IMODE((tmp_path / ".studio-token").stat().st_mode) == 0o600
    restored = Settings(data_dir=tmp_path, studio_token="")
    restored.prepare()
    assert restored.studio_token == settings.studio_token


def test_login_rate_limit(client):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"token": "incorrect"}).status_code == 401
    assert client.post("/api/auth/login", json={"token": "incorrect"}).status_code == 429


def test_import_search_metadata_and_crop(client, image_bytes):
    panel = add_panel(client, image_bytes)
    assert panel["width"] == 480 and panel["height"] == 720
    for term in ["Azure", "originals", "skirmish", "7"]:
        assert len(client.get("/api/panels", params={"q": term}).json()) == 1
    assert client.get("/api/panels?q=missing").json() == []
    crop = client.post(
        f"/api/panels/{panel['id']}/crop",
        json={"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5, "output_width": 200},
    )
    assert crop.status_code == 201, crop.text
    result = crop.json()
    assert result["parent_id"] == panel["id"]
    assert (result["width"], result["height"]) == (200, 300)
    assert result["series"] == panel["series"]
    assert client.get(panel["image_url"]).status_code == 200
    bad = client.post(
        f"/api/panels/{panel['id']}/crop", json={"x": 0.9, "y": 0, "width": 0.5, "height": 1}
    )
    assert bad.status_code == 422
    assert client.get("/api/media/studio.sqlite3").status_code == 404
    assert client.get("/api/media/panels/%2e%2e/studio.sqlite3").status_code == 404
    updated = client.patch(f"/api/panels/{panel['id']}", json={"fight": "Updated fight notes"})
    assert updated.status_code == 200
    assert updated.json()["series"] == panel["series"]
    assert updated.json()["fight"] == "Updated fight notes"


def test_cbz_natural_order_and_pdf_pages(client, image_bytes):
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w") as cbz:
        cbz.writestr("page10.png", image_bytes)
        cbz.writestr("page2.png", image_bytes)
    response = client.post(
        "/api/panels/import",
        files=[("files", ("example.cbz", archive.getvalue(), "application/zip"))],
        data={"metadata": '{"page": 4}'},
    )
    assert response.status_code == 201, response.text
    assert [p["page"] for p in response.json()] == [4, 5]
    pdf = io.BytesIO()
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image.save(pdf, format="PDF", save_all=True, append_images=[image])
    response = client.post(
        "/api/panels/import", files=[("files", ("example.pdf", pdf.getvalue(), "application/pdf"))]
    )
    assert response.status_code == 201, response.text
    assert [p["page"] for p in response.json()] == [1, 2]
    assert all(p["width"] > 0 for p in response.json())


def test_failed_import_is_atomic(client, image_bytes, settings):
    response = client.post(
        "/api/panels/import",
        files=[
            ("files", ("good.png", image_bytes, "image/png")),
            ("files", ("bad.png", b"broken", "image/png")),
        ],
    )
    assert response.status_code == 422
    assert client.get("/api/panels").json() == []
    assert not list((settings.data_dir / "panels").glob("*.jpg"))


def test_cbz_traversal_and_bomb_are_rejected(client, image_bytes):
    for name, data in [("../escape.png", image_bytes), ("huge.png", b"0" * 1000000)]:
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as cbz:
            cbz.writestr(name, data)
        response = client.post(
            "/api/panels/import",
            files=[("files", ("unsafe.cbz", archive.getvalue(), "application/zip"))],
        )
        assert response.status_code == 422
    assert client.get("/api/panels").json() == []


def test_templates_and_project_settings_persist(client):
    template = client.post(
        "/api/templates",
        json={
            "name": "Custom",
            "settings": {"fps": 30, "transition": "cut", "default_motion": "pan_left"},
        },
    ).json()
    project = client.post(
        "/api/projects", json={"title": "Custom defaults", "template_id": template["id"]}
    ).json()
    assert project["settings"]["fps"] == 30
    assert project["settings"]["default_motion"] == "pan_left"
    changed = client.patch(f"/api/projects/{project['id']}", json={"title": "A new title"})
    assert changed.status_code == 200
    assert client.get(f"/api/projects/{project['id']}").json()["title"] == "A new title"


def test_scene_reorder_validation_and_script_approval(client, image_bytes):
    panel = add_panel(client, image_bytes)
    project = add_project(client)
    url = f"/api/projects/{project['id']}"
    assert client.patch(url, json={"script_approved": True}).status_code == 422
    assert (
        client.patch(url, json={"script": "A punchline", "script_approved": True}).status_code
        == 422
    )
    assert (
        client.patch(url, json={"script": "That footwork just filed for retirement."}).status_code
        == 200
    )
    assert client.patch(url, json={"script_approved": True}).json()["script_approved"]
    response = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {"panel_id": panel["id"], "duration": 2, "caption": "First"},
                {"panel_id": panel["id"], "duration": 3, "caption": "Second"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert not result["script_approved"]
    assert result["duration"] == 5
    scenes = [
        {k: s[k] for k in ["id", "panel_id", "duration", "motion", "caption"]}
        for s in result["scenes"]
    ]
    reversed_result = client.put(url + "/scenes", json={"scenes": list(reversed(scenes))}).json()
    assert [s["caption"] for s in reversed_result["scenes"]] == ["Second", "First"]
    assert client.put(url + "/scenes", json={"scenes": [scenes[0], scenes[0]]}).status_code == 422
    other = add_project(client)
    assert (
        client.put(f"/api/projects/{other['id']}/scenes", json={"scenes": scenes}).status_code
        == 422
    )
    assert (
        client.put(
            url + "/scenes", json={"scenes": [{"panel_id": panel["id"], "duration": -1}]}
        ).status_code
        == 422
    )
    assert client.patch(url, json={"script": None}).status_code == 422
    assert client.post(url + "/renders", json={}).status_code == 422


def test_audio_upload_and_missing_ai_provider(client):
    project = add_project(client)
    url = f"/api/projects/{project['id']}"
    bad = client.post(url + "/narration", files={"file": ("bad.wav", b"not audio", "audio/wav")})
    assert bad.status_code == 422
    response = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(), "audio/wav")}
    )
    assert response.status_code == 200, response.text
    assert response.json()["narration_duration"] == pytest.approx(1.5, abs=0.05)
    assert client.post(url + "/draft", json={}).status_code == 503
    assert not client.get("/api/integrations").json()["writing_enabled"]


def test_snapshot_and_interrupted_job_recovery(client, image_bytes, monkeypatch):
    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}"
    client.put(url + "/scenes", json={"scenes": [{"panel_id": panel["id"], "duration": 1}]})
    client.patch(url, json={"script": "Verdict is in."})
    client.patch(url, json={"script_approved": True})
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(2), "audio/wav")})
    assert client.post(url + "/renders").status_code == 422  # Never cut off narration.
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(0.5), "audio/wav")})
    renderer = client.app.state.renderer
    monkeypatch.setattr(renderer, "enqueue", lambda _: None)
    response = client.post(url + "/renders")
    assert response.status_code == 202, response.text
    job = response.json()
    assert client.post(url + "/renders").status_code == 409
    client.patch(url, json={"script": "A different script"})
    with client.app.state.sessions() as db:
        snapshot = db.get(RenderJob, job["id"]).snapshot
        assert snapshot["script"] == "Verdict is in."
        assert snapshot["scenes"][0]["duration"] == 1
    renderer.recover()
    recovered = client.get(f"/api/renders/{job['id']}").json()
    assert recovered["status"] == "failed"
    assert "restart" in recovered["error"]
    assert client.get(url).json()["status"] == "scripting"


@pytest.mark.parametrize(
    "key", ["../studio.sqlite3", "/etc/passwd", "panels/../../x", "panels\\..\\x"]
)
def test_storage_rejects_path_escape(tmp_path, key):
    with pytest.raises(ValueError):
        LocalStorage(tmp_path).path(key)


def test_invalid_metadata_does_not_create_panels(client, image_bytes):
    response = client.post(
        "/api/panels/import",
        files=[("files", ("original.png", image_bytes))],
        data={"metadata": json.dumps({"page": -1})},
    )
    assert response.status_code == 422
    assert client.get("/api/panels").json() == []


def test_request_body_limit_rejects_large_declared_length(client):
    response = client.post(
        "/api/projects",
        content=b"{}",
        headers={"Content-Length": str(70 * 1024 * 1024), "Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_chunked_request_limit_cannot_be_bypassed(settings):
    from fastapi.testclient import TestClient

    from app.main import create_app

    settings.max_upload_bytes = 1
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/projects",
            content=iter([b"x" * 600000, b"y" * 600000]),
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
        )
        assert response.status_code == 413
