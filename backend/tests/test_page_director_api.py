"""Exercise the original-page → virtual panel scenes → safe save pipeline."""

import io
import time

from conftest import add_project, wav_bytes
from PIL import Image, ImageDraw

from app.database import RenderJob
from app.schemas import SceneInput


def page_png():
    image = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 792, 305), fill="#254d65")
    draw.rectangle((8, 355, 376, 792), fill="#5d2828")
    draw.rectangle((434, 355, 792, 792), fill="#286035")
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def wait_director(client, url):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        client.app.state.director.sync_renders()
        jobs = client.get(url + "/director").json()
        if jobs and jobs[0]["status"] not in ("queued", "working", "rendering"):
            return jobs[0]
        time.sleep(0.1)
    raise AssertionError("Page-directed episode did not finish planning")


def test_complete_page_becomes_timed_editable_3_shot_preview(client, monkeypatch):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    image = client.post(
        url + "/import-file",
        files={"file": ("complete_page.png", page_png(), "image/png")},
        data={"kind": "panels"},
    )
    assert image.status_code == 201, image.text
    project = image.json()["project"]
    assert len(client.get("/api/panels").json()) == 1, "Do not create duplicate cropped assets"
    audio = client.post(
        url + "/import-file",
        files={"file": ("verdict.wav", wav_bytes(4), "audio/wav")},
        data={"kind": "narration"},
    )
    assert audio.status_code == 201, audio.text
    project = audio.json()["project"]
    enabled = client.put(
        url + "/autopilot",
        json={
            "base_revision": project["revision"],
            "enabled": True,
            "mode": "basic",
            "pace": "slow",
            "delivery": "draft",
        },
    )
    assert enabled.status_code == 200, enabled.text
    project = enabled.json()

    def finish(job_id):
        with client.app.state.sessions() as db:
            render = db.get(RenderJob, job_id)
            render.status, render.progress = "completed", 100
            db.commit()

    monkeypatch.setattr(client.app.state.renderer, "enqueue", finish)

    started = client.post(url + "/director", json={"base_revision": project["revision"]})
    assert started.status_code == 202, started.text
    job = wait_director(client, url)
    assert job["status"] == "completed", job
    assert job["report"]["page_reading"]["expanded"] is True
    saved = client.get(url).json()
    # Slow pacing makes at least one shot per actual comic panel.
    assert len(saved["scenes"]) >= 3
    assert saved["scenes"][0]["motion"] == "panel_glide"
    assert saved["scenes"][0]["source_crop"]
    assert len({scene["panel_id"] for scene in saved["scenes"]}) == 1
    assert len(client.get("/api/panels").json()) == 1

    # Crop edits are a normal autosaved/undoable scene change.
    original = saved["scenes"][0]["source_crop"]
    edited = saved["scenes"]
    edited[0]["source_crop"] = {**original, "width": original["width"] * 0.95}
    changed = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {k: v for k, v in scene.items() if k in SceneInput.model_fields} for scene in edited
            ]
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["scenes"][0]["source_crop"]["width"] < original["width"]
    restored = client.post(
        url + "/history/undo",
        json={"base_revision": changed.json()["revision"]},
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["scenes"][0]["source_crop"] == original


    # The creator's manually drawn numbered route and travel speed must
    # survive a real API save/reload and remain reversible via Undo.
    routed = restored.json()["scenes"]
    routed[0]["motion"] = "panel_glide"
    routed[0]["camera_path"] = [
        {"x": 0.15, "y": 0.4},
        {"x": 0.45, "y": 0.55},
        {"x": 0.9, "y": 0.6},
    ]
    routed[0]["path_move_fraction"] = 0.35
    routed[0]["path_zoom"] = 1.6
    changed = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {k: v for k, v in scene.items() if k in SceneInput.model_fields}
                for scene in routed
            ]
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["scenes"][0]["camera_path"][2]["x"] == 0.9
    assert changed.json()["scenes"][0]["path_move_fraction"] == 0.35
    assert changed.json()["scenes"][0]["path_zoom"] == 1.6
    reloaded = client.get(url).json()
    assert len(reloaded["scenes"][0]["camera_path"]) == 3
    undone = client.post(
        url + "/history/undo",
        json={"base_revision": reloaded["revision"]},
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["scenes"][0]["camera_path"] is None
