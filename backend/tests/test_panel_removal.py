import hashlib
import shutil
import time

import pytest
from conftest import add_panel, add_project, wav_bytes
from sqlalchemy import select

from app.database import Panel, Project, RenderJob, connect


def test_removal_and_restore_preserve_sources_crops_and_survive_reconnect(client, image_bytes):
    panel = add_panel(client, image_bytes)
    child = client.post(
        f"/api/panels/{panel['id']}/crop",
        json={"x": 0, "y": 0, "width": 0.5, "height": 1},
    ).json()
    original = client.get(panel["image_url"]).content
    thumbnail = client.get(panel["thumbnail_url"]).content
    url = f"/api/panels/{panel['id']}"
    for _ in range(2):
        response = client.delete(url)
        assert response.status_code == 200, response.text
        assert response.json() == {"id": panel["id"], "removed": True}
        assert [p["id"] for p in client.get("/api/panels").json()] == [child["id"]]
        assert [p["id"] for p in client.get("/api/panels", params={"q": "Placeholder"}).json()] == [
            child["id"]
        ]
        removed = client.get("/api/panels", params={"removed": True, "q": "Placeholder"})
        assert [p["id"] for p in removed.json()] == [panel["id"]]
        assert client.get("/api/panels?removed=true&q=missing").json() == []
    assert client.get(panel["image_url"]).content == original
    assert client.get(panel["thumbnail_url"]).content == thumbnail
    assert client.get(child["image_url"]).status_code == 200
    engine, sessions = connect(client.app.state.settings.data_dir)
    try:
        with sessions() as db:
            assert not db.get(Panel, panel["id"]).in_library
            assert db.get(Panel, child["id"]).parent_id == panel["id"]
    finally:
        engine.dispose()
    for _ in range(2):
        assert client.post(url + "/restore").json() == panel
    assert len(client.get("/api/panels").json()) == 2
    assert client.get("/api/panels?removed=true").json() == []


def test_removal_requires_authentication_and_same_origin(client, image_bytes):
    panel = add_panel(client, image_bytes)
    url = f"/api/panels/{panel['id']}"
    for method, path in [("DELETE", url), ("POST", url + "/restore")]:
        assert (
            client.request(method, path, headers={"Origin": "https://other.example"}).status_code
            == 403
        )
    assert client.delete("/api/panels/missing").status_code == 404
    assert client.post("/api/panels/missing/restore").status_code == 404
    client.headers.pop("Authorization")
    assert client.delete(url).status_code == 401
    assert client.post(url + "/restore").status_code == 401
    assert client.get("/api/panels?removed=true").status_code == 401


def test_existing_library_migrates_in_place_without_restoring_removed_panels(tmp_path):
    engine, sessions = connect(tmp_path)
    with sessions() as db:
        panel = Panel(
            title="Existing artwork",
            storage_key="panels/keep.png",
            thumbnail_key="panels/keep-thumb.png",
            width=480,
            height=720,
        )
        db.add(panel)
        db.commit()
        panel_id = panel.id
    # Simulate the schema shipped before library removal existed.
    with engine.begin() as db:
        db.exec_driver_sql("ALTER TABLE panels DROP COLUMN in_library")
    engine.dispose()
    for expected in [True, False]:
        engine, sessions = connect(tmp_path)
        with sessions() as db:
            panel = db.get(Panel, panel_id)
            assert panel.in_library is expected
            assert (panel.title, panel.storage_key, panel.width) == (
                "Existing artwork",
                "panels/keep.png",
                480,
            )
            panel.in_library = False
            db.commit()
        engine.dispose()


def test_removed_panel_keeps_project_versions_history_and_queued_jobs(
    client, image_bytes, monkeypatch
):
    from test_workflow import payload

    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}"
    project = client.put(
        url + "/scenes", json={"scenes": [{"panel_id": panel["id"], "duration": 1}]}
    ).json()
    version = client.post(url + "/versions", json={"name": "Keep artwork"}).json()
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(1), "audio/wav")}
    ).json()
    monkeypatch.setattr(client.app.state.renderer, "enqueue", lambda _: None)
    queued = client.post(url + "/renders", json={"quality": "draft"})
    assert queued.status_code == 202, queued.text
    with client.app.state.sessions() as db:
        job = db.get(RenderJob, queued.json()["id"])
        saved_job = job.snapshot
        saved_history = db.get(Project, project["id"]).edit_history
    client.delete(f"/api/panels/{panel['id']}")
    assert client.get(url).json() == project
    assert client.get(url + f"/versions/{version['id']}").json()["scenes"][0]["panel"] == panel
    with client.app.state.sessions() as db:
        assert db.get(RenderJob, queued.json()["id"]).snapshot == saved_job
        assert db.get(Project, project["id"]).edit_history == saved_history
    empty = client.put(url + "/workspace", json=payload(project, scenes=[])).json()
    restored = client.post(url + "/history/undo", json={"base_revision": empty["revision"]}).json()
    assert restored["scenes"][0]["panel"] == panel
    redone = client.post(url + "/history/redo", json={"base_revision": restored["revision"]}).json()
    assert redone["scenes"] == []
    restored = client.post(
        url + f"/versions/{version['id']}/restore",
        json={"base_revision": redone["revision"]},
    ).json()
    assert restored["scenes"][0]["panel"] == panel
    assert client.get("/api/panels").json() == []


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_project_renders_after_its_source_is_removed_from_library(client, image_bytes):
    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}"
    client.put(url + "/scenes", json={"scenes": [{"panel_id": panel["id"], "duration": 1}]})
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(1), "audio/wav")})
    digest = hashlib.sha256(client.get(panel["image_url"]).content).hexdigest()
    assert client.delete(f"/api/panels/{panel['id']}").status_code == 200
    response = client.post(url + "/renders", json={"quality": "draft"})
    assert response.status_code == 202, response.text
    job = response.json()
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"failed", "completed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    assert client.get(job["download_url"]).content[4:8] == b"ftyp"
    assert hashlib.sha256(client.get(panel["image_url"]).content).hexdigest() == digest
    with client.app.state.sessions() as db:
        assert not list(db.scalars(select(Panel).where(Panel.in_library.is_(True))))
