"""Reversible production lifecycle, source preservation and stale/active work guards."""

import hashlib

import pytest
from conftest import add_project, wav_bytes
from test_workflow import payload, populated

from app.database import DirectorJob, Panel, Project, RenderJob


def trash(client, url, revision):
    return client.request("DELETE", url, json={"base_revision": revision})


def test_trash_restore_preserves_media_shots_history_and_other_productions(client, image_bytes):
    project, url = populated(client, image_bytes)
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(), "audio/wav")}
    ).json()
    project = client.put(url + "/workspace", json=payload(project, script="Keep this edit")).json()
    other = add_project(client)
    with client.app.state.sessions() as db:
        record = db.get(Project, project["id"])
        history = record.edit_history
        panel = db.get(Panel, project["scenes"][0]["panel_id"])
        keys = [record.narration_key, panel.storage_key, panel.thumbnail_key]
        job = RenderJob(
            project_id=project["id"],
            project_revision=project["revision"],
            status="completed",
            snapshot={},
            output_key="exports/keep.mp4",
        )
        db.add(job)
        db.commit()
        render_id = job.id
    client.app.state.storage.path("exports").mkdir(parents=True, exist_ok=True)
    client.app.state.storage.path("exports/keep.mp4").write_bytes(b"original export")
    keys.append("exports/keep.mp4")
    before = {
        k: hashlib.sha256(client.app.state.storage.path(k).read_bytes()).hexdigest() for k in keys
    }
    deleted = trash(client, url, project["revision"])
    assert deleted.status_code == 200, deleted.text
    deleted = deleted.json()
    assert deleted["deleted_at"] and deleted["revision"] == project["revision"] + 1
    assert project["id"] not in [p["id"] for p in client.get("/api/projects").json()]
    assert client.get("/api/projects?trashed=true").json() == [deleted]
    assert client.get(url).status_code == 404
    assert client.get("/api/projects/" + other["id"]).status_code == 200
    assert render_id not in [j["id"] for j in client.get("/api/renders").json()]
    assert client.get("/api/panels").json()[0]["id"] == panel.id
    assert trash(client, url, deleted["revision"]).status_code == 404
    stale = client.post(url + "/restore", json={"base_revision": project["revision"]})
    assert stale.status_code == 409
    restored = client.post(url + "/restore", json={"base_revision": deleted["revision"]})
    assert restored.status_code == 200, restored.text
    restored = client.get(url).json()
    for key in ["scenes", "script", "narration_url", "caption_cues", "workflow", "settings"]:
        assert restored[key] == project[key]
    assert restored["deleted_at"] is None
    assert client.get("/api/projects?trashed=true").json() == []
    assert render_id in [j["id"] for j in client.get("/api/renders").json()]
    with client.app.state.sessions() as db:
        assert db.get(Project, project["id"]).edit_history == history
    assert before == {
        k: hashlib.sha256(client.app.state.storage.path(k).read_bytes()).hexdigest() for k in keys
    }
    assert (
        client.post(url + "/restore", json={"base_revision": restored["revision"]}).status_code
        == 409
    )


def test_stale_delete_and_restore_cannot_overwrite_new_work(client):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    updated = client.patch(url, json={"title": "Fresh edits"}).json()
    assert trash(client, url, project["revision"]).status_code == 409
    assert client.get(url).json() == updated
    deleted = trash(client, url, updated["revision"]).json()
    restored = client.post(url + "/restore", json={"base_revision": deleted["revision"]}).json()
    assert trash(client, url, updated["revision"]).status_code == 409
    assert client.get(url).json()["revision"] == restored["revision"]


@pytest.mark.parametrize(
    "model,status",
    [(DirectorJob, s) for s in ["queued", "working", "rendering"]]
    + [(RenderJob, s) for s in ["queued", "running"]],
)
def test_delete_waits_for_active_work(client, model, status):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    with client.app.state.sessions() as db:
        fields = {
            "base_revision" if model is DirectorJob else "project_revision": project["revision"]
        }
        db.add(model(project_id=project["id"], status=status, snapshot={}, **fields))
        db.commit()
    response = trash(client, url, project["revision"])
    assert response.status_code == 409, response.text
    assert client.get(url).json() == project


def test_trashed_production_rejects_edit_build_and_preview_routes(client, image_bytes):
    project, url = populated(client, image_bytes)
    assert trash(client, url, project["revision"]).status_code == 200
    revision = {"base_revision": project["revision"] + 1}
    requests = [
        ("PATCH", url, {"title": "hidden edit"}),
        ("PUT", url + "/workspace", payload(project, **revision)),
        ("POST", url + "/history/undo", revision),
        ("GET", url + "/assistant/context", None),
        ("POST", url + "/panel-organization/preview", revision),
        ("POST", url + "/director", revision),
    ]
    for method, path, body in requests:
        response = client.request(method, path, **({"json": body} if body is not None else {}))
        assert response.status_code == 404, (path, response.text)


def test_trash_pauses_folder_watcher_and_restore_keeps_preference(client, image_bytes):
    from app.inbox import InboxWatcher

    project = add_project(client)
    url = "/api/projects/" + project["id"]
    with client.app.state.sessions() as db:
        record = db.get(Project, project["id"])
        record.watch_enabled = True
        db.commit()
    state = client.app.state
    folder = state.storage.path("inbox/" + project["id"])
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "page.png").write_bytes(image_bytes)
    watcher = InboxWatcher(state.settings, state.storage, state.sessions)
    deleted = trash(client, url, project["revision"]).json()
    watcher.scan()
    watcher.scan()
    assert client.get("/api/panels").json() == []
    restored = client.post(url + "/restore", json={"base_revision": deleted["revision"]}).json()
    assert restored["watch_enabled"]
    watcher.scan()
    watcher.scan()
    assert len(client.get("/api/panels").json()) == 1
