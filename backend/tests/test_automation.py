import io
import math
import time
import wave
from array import array
from pathlib import Path

import pytest
from conftest import add_panel, add_project, wav_bytes
from test_workflow import payload

from app.database import RenderJob
from app.renderer import probe


def fixture_project(client, image_bytes, duration=6):
    first = add_panel(client, image_bytes, "Azure punch")
    second = add_panel(client, image_bytes, "Slate reveal")
    client.patch(
        "/api/panels/" + first["id"], json={"characters": "Azure", "fight": "punch impact"}
    )
    client.patch(
        "/api/panels/" + second["id"], json={"characters": "Slate", "fight": "surprise reveal"}
    )
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    project = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {"panel_id": first["id"], "duration": duration / 2},
                {"panel_id": second["id"], "duration": duration / 2},
            ]
        },
    ).json()
    response = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(duration), "audio/wav")}
    )
    assert response.status_code == 200, response.text
    project = response.json()
    project = client.put(
        url + "/workspace",
        json=payload(
            project,
            script="Azure punches hard! Slate reveals a surprise.",
            cues=[
                {"start": 0, "end": duration / 2, "text": "Azure punches hard!"},
                {"start": duration / 2, "end": duration, "text": "Slate reveals a surprise."},
            ],
        ),
    ).json()
    return project, url, first, second


def test_build_draft_matches_tags_adds_effects_and_never_writes_without_accept(client, image_bytes):
    project, url, first, second = fixture_project(client, image_bytes)
    response = client.post(url + "/build-draft", json={})
    assert response.status_code == 200, response.text
    result = response.json()
    assert len(result["scenes"]) > 2
    assert result["scenes"][0]["panel_id"] == first["id"]
    assert result["scenes"][-1]["panel_id"] == second["id"]
    assert result["scenes"][0]["sfx_id"] == "builtin-impact"
    assert any(s["sfx_id"] == "builtin-whoosh" for s in result["scenes"])
    assert result["base_revision"] == project["revision"]
    unchanged = client.get(url).json()
    assert unchanged["revision"] == project["revision"]
    assert unchanged["scenes"] == project["scenes"]
    accepted = client.put(
        url + "/workspace",
        json=payload(project, scenes=result["scenes"], settings=result["settings"]),
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["scenes"][0]["sfx_url"].endswith("builtin-impact.wav")


def test_locked_shots_survive_auto_edit_build_and_history(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes)
    scenes = payload(project)["scenes"]
    scenes[0].update(
        locked=True, motion="pan_down", focus_y=0.8, framing="fit", note="Keep this shot"
    )
    project = client.put(url + "/workspace", json=payload(project, scenes=scenes)).json()
    for route, data in [("/auto-edit", {"pace": "fast"}), ("/build-draft", {"pace": "slow"})]:
        response = client.post(url + route, json=data)
        assert response.status_code == 200, response.text
        locked = response.json()["scenes"][0]
        assert all(
            locked[k] == project["scenes"][0][k]
            for k in ["id", "duration", "motion", "focus_y", "framing", "note", "locked"]
        )
    response = client.post(
        url + "/build-draft",
        json={"camera_moves": False, "sound_effects": False, "match_panels": False},
    )
    assert response.status_code == 200
    assert all(
        s["motion"] == p["motion"] for s, p in zip(response.json()["scenes"], project["scenes"])
    )


def test_storyboard_assignments_and_validation(client, image_bytes):
    project, url, first, second = fixture_project(client, image_bytes)
    cards = client.get(url + "/storyboard").json()["cards"]
    assert [c["panel_id"] for c in cards] == [first["id"], second["id"]]
    saved = [
        {k: v for k, v in card.items() if k in {"start", "end", "text", "panel_id", "beat"}}
        for card in cards
    ]
    saved[0]["panel_id"] = second["id"]
    project = client.put(
        url + "/workspace",
        json=payload(
            project, workflow={"panel_ids": [first["id"], second["id"]], "storyboard": saved}
        ),
    ).json()
    assert (
        client.post(url + "/build-draft", json={}).json()["scenes"][0]["panel_id"] == second["id"]
    )
    for workflow in [
        {"panel_ids": ["missing"]},
        {"notes": [{"time": "nan", "text": "Bad", "id": "n"}]},
        {"storyboard": [{"text": "x"}]},
        {"unexpected": True},
    ]:
        assert (
            client.put(url + "/workspace", json=payload(project, workflow=workflow)).status_code
            == 422
        )
    assert client.get(url).json()["revision"] == project["revision"]


def test_versions_restore_and_duplicate_keep_structure_without_id_collisions(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes)
    version = client.post(url + "/versions", json={"name": "Edit A"}).json()
    saved = client.get(url + "/versions/" + version["id"]).json()
    assert saved["scenes"] == project["scenes"]
    changed = client.put(url + "/workspace", json=payload(project, title="Edit B", cues=[])).json()
    restored = client.post(
        url + "/versions/" + version["id"] + "/restore", json={"base_revision": changed["revision"]}
    )
    assert restored.status_code == 200, restored.text
    assert restored.json()["title"] == project["title"]
    assert restored.json()["caption_cues"] == project["caption_cues"]
    assert not restored.json()["script_approved"]
    duplicate = client.post(url + "/duplicate", json={"name": "Episode two"})
    assert duplicate.status_code == 201, duplicate.text
    duplicate = duplicate.json()
    assert duplicate["narration_url"] == project["narration_url"]
    assert duplicate["scenes"][0]["panel_id"] == project["scenes"][0]["panel_id"]
    assert duplicate["scenes"][0]["id"] != project["scenes"][0]["id"]
    assert not duplicate["script_approved"]
    assert (
        client.post(
            "/api/projects/" + duplicate["id"] + "/versions/" + version["id"] + "/restore",
            json={"base_revision": duplicate["revision"]},
        ).status_code
        == 404
    )


def test_favorite_sound_offset_and_uploaded_sound_can_be_duplicated_and_cleared(
    client, image_bytes
):
    project, url, _, _ = fixture_project(client, image_bytes)
    favorite = client.post(
        "/api/sound-effects",
        data={"name": "My hit", "kind": "impact"},
        files={"file": ("hit.wav", wav_bytes(0.2), "audio/wav")},
    )
    assert favorite.status_code == 201
    scenes = payload(project)["scenes"]
    scenes[0].update(sfx_id=favorite.json()["id"], sfx_offset=0.5)
    project = client.put(url + "/workspace", json=payload(project, scenes=scenes)).json()
    assert project["scenes"][0]["sfx_url"] == favorite.json()["url"]
    project = client.post(
        url + "/scenes/" + project["scenes"][0]["id"] + "/sfx",
        files={"file": ("custom.wav", wav_bytes(0.3), "audio/wav")},
    ).json()
    custom = project["scenes"][0]["sfx_url"]
    scenes = payload(project)["scenes"]
    import uuid

    clone = {**scenes[0], "id": uuid.uuid4().hex, "sfx_source_id": scenes[0]["id"]}
    scenes[0].update(clear_sfx=True)
    scenes.insert(1, clone)
    response = client.put(url + "/workspace", json=payload(project, scenes=scenes))
    assert response.status_code == 200, response.text
    assert response.json()["scenes"][0]["sfx_url"] is None
    assert response.json()["scenes"][1]["sfx_url"] == custom
    bad = payload(response.json())
    bad["scenes"][1]["sfx_source_id"] = "foreign-scene"
    assert client.put(url + "/workspace", json=bad).status_code == 422


def voiced_wav():
    rate, samples = 16000, array("h")
    # Two original tones with a deliberate 1.6-second pause between them.
    for i in range(rate * 4):
        t = i / rate
        samples.append(round(7000 * math.sin(2 * math.pi * 220 * t)) if t < 1.2 or t >= 2.8 else 0)
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        wav.writeframes(samples.tobytes())
    return output.getvalue()


def test_audio_cleanup_is_reviewable_retimes_captions_and_undo_restores_original(
    client, image_bytes
):
    project, url, _, _ = fixture_project(client, image_bytes, 4)
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", voiced_wav(), "audio/wav")}
    ).json()
    project = client.put(
        url + "/workspace",
        json=payload(project, cues=[{"start": 2.9, "end": 3.5, "text": "After the pause"}]),
    ).json()
    response = client.post(
        url + "/audio/prepare", json={"reduce_noise": True, "shorten_pauses": True}
    )
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["removed_seconds"] > 1
    assert client.get(url).json()["narration_url"] == project["narration_url"]
    assert client.get(preview["after_url"]).status_code == 200
    accepted = client.post(
        url + "/versions/" + preview["id"] + "/restore", json={"base_revision": project["revision"]}
    )
    assert accepted.status_code == 200, accepted.text
    clean = accepted.json()
    assert clean["narration_duration"] < 3
    assert clean["caption_cues"][0]["start"] < 2
    assert abs(clean["duration"] - clean["narration_duration"]) < 0.06
    original = client.post(url + "/history/undo", json={"base_revision": clean["revision"]}).json()
    assert original["narration_url"] == project["narration_url"]
    assert original["caption_cues"] == project["caption_cues"]
    assert (
        client.post(
            url + "/versions/" + preview["id"] + "/restore",
            json={"base_revision": original["revision"]},
        ).status_code
        == 409
    )


def test_shorts_use_tagged_later_payoff_and_sentence_boundaries(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes, 40)
    cues = [
        {"start": 0, "end": 8, "text": "Some background."},
        {"start": 10, "end": 15, "text": "Why challenge Azure?"},
        {"start": 20, "end": 25, "text": "Azure punches and smashes."},
        {"start": 30, "end": 39, "text": "The knockout hits hard!"},
    ]
    project = client.put(url + "/workspace", json=payload(project, cues=cues)).json()
    candidates = client.get(url + "/shorts").json()["candidates"]
    assert candidates and candidates[0]["start"] > 0
    assert candidates[0]["end"] - candidates[0]["start"] <= 30
    assert candidates[0]["end"] in {25, 39}


def test_drop_import_keeps_project_assets_and_replacement_keeps_cameras(client, image_bytes):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    imported = client.post(
        url + "/import-file",
        data={"kind": "panels"},
        files={"file": ("panel.png", image_bytes, "image/png")},
    )
    assert imported.status_code == 201, imported.text
    project = imported.json()["project"]
    assert len(project["workflow"]["panel_ids"]) == 1
    panel_id = project["workflow"]["panel_ids"][0]
    project = client.put(
        url + "/workspace",
        json=payload(project, scenes=[{"panel_id": panel_id, "motion": "punch_in", "duration": 2}]),
    ).json()
    original_id = project["scenes"][0]["id"]
    for name in ["voice.wav", "music-background.wav", "sfx-impact.wav"]:
        response = client.post(
            url + "/import-file", files={"file": (name, wav_bytes(2), "audio/wav")}
        )
        assert response.status_code == 201, response.text
    latest = client.get(url).json()
    assert latest["narration_url"] and latest["music_url"]
    assert latest["scenes"][0]["id"] == original_id and latest["scenes"][0]["motion"] == "punch_in"
    assert any(e["name"] == "sfx-impact" for e in client.get("/api/sound-effects").json())


def test_watched_folder_imports_stable_files_once_and_records_errors(client, image_bytes):
    watcher = client.app.state.inbox
    watcher.stop()  # Drive passes explicitly, without timing-dependent sleeps.
    watcher.stop_event.clear()
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    inbox = client.get(url + "/inbox").json()
    assert not inbox["enabled"]
    folder = Path(inbox["path"])
    (folder / "panel.png").write_bytes(image_bytes)
    watcher.scan()
    assert not client.get(url).json()["workflow"]
    client.put(url + "/inbox", json={"enabled": True})
    watcher.scan()
    assert not client.get(url).json()["workflow"]
    watcher.scan()
    assert len(client.get(url).json()["workflow"]["panel_ids"]) == 1
    watcher.scan()
    assert len(client.get(url).json()["workflow"]["panel_ids"]) == 1
    (folder / "invalid.png").write_bytes(b"not an image")
    watcher.scan()
    watcher.scan()
    entries = client.get(url + "/inbox").json()["files"]
    assert len(entries) == 2 and any(e["status"] == "failed" for e in entries)
    assert (folder / "panel.png").read_bytes() == image_bytes


def test_missing_panel_reconnect_requires_original_dimensions_and_preserves_scene(
    client, image_bytes
):
    project, url, panel, _ = fixture_project(client, image_bytes)
    path = client.app.state.storage.path(panel["image_url"].removeprefix("/api/media/"))
    original = path.read_bytes()
    path.unlink()
    check = client.get(url + "/asset-check").json()
    assert any(a["id"] == panel["id"] and a["missing"] for a in check["assets"])
    response = client.post(
        url + "/recover-file",
        data={"kind": "panel", "asset_id": panel["id"]},
        files={"file": ("original.png", original, "image/png")},
    )
    assert response.status_code == 200, response.text
    assert path.is_file()
    assert client.get(url).json()["scenes"] == project["scenes"]
    assert (
        client.post(
            url + "/recover-file",
            data={"kind": "panel", "asset_id": panel["id"]},
            files={"file": ("original.png", original, "image/png")},
        ).status_code
        == 409
    )


def wait_export(client, job_id):
    for _ in range(180):
        job = client.get("/api/renders/" + job_id).json()
        if job["status"] in {"completed", "failed"}:
            assert job["status"] == "completed", job
            return job
        time.sleep(0.15)
    pytest.fail("Export timed out")


@pytest.mark.render
def test_section_export_is_shorter_keeps_camera_phase_and_has_readable_filename(
    client, image_bytes
):
    project, url, _, _ = fixture_project(client, image_bytes, 3)
    project = client.post(
        url + "/music", files={"file": ("music.wav", wav_bytes(0.3), "audio/wav")}
    ).json()
    client.post(
        url + "/scenes/" + project["scenes"][0]["id"] + "/sfx",
        files={"file": ("hit.wav", wav_bytes(0.2), "audio/wav")},
    )
    response = client.post(url + "/renders", json={"quality": "draft", "start": 0.5, "end": 1.5})
    assert response.status_code == 202, response.text
    job = wait_export(client, response.json()["id"])
    path = client.app.state.storage.path(job["video_url"].removeprefix("/api/media/"))
    result = probe(path, client.app.state.settings)
    assert result["duration"] == pytest.approx(1, abs=0.06)
    video = next(s for s in result["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (360, 640)
    with client.app.state.sessions() as db:
        snapshot = db.get(RenderJob, job["id"]).snapshot
        assert snapshot["scenes"][0]["motion_offset_frames"] == 12
        assert snapshot["settings"]["narration_start"] == 0.5
        assert snapshot["music_offset"] == 0.5
        assert snapshot["scenes"][0]["sfx_trim"] == 0.5
    download = client.get("/api/renders/" + job["id"] + "/download")
    assert "The_test_beatdown_Section_v" in download.headers["content-disposition"]
    assert (
        client.post(url + "/renders", json={"quality": "final", "start": 0, "end": 1}).status_code
        == 422
    )


def test_batch_export_queues_valid_projects_and_reports_unapproved_ones(
    client, image_bytes, monkeypatch
):
    project, url, _, _ = fixture_project(client, image_bytes, 2)
    ready = client.patch(url, json={"script_approved": True}).json()
    unready = add_project(client)
    queued = []
    monkeypatch.setattr(client.app.state.renderer, "enqueue", queued.append)
    response = client.post(
        "/api/renders/batch", json={"project_ids": [ready["id"], unready["id"], ready["id"]]}
    )
    assert response.status_code == 202, response.text
    result = response.json()
    assert len(result["jobs"]) == 1 and len(result["errors"]) == 1
    assert len(queued) == 1
    assert result["errors"][0]["project_id"] == unready["id"]


def test_build_uses_operator_sound_choices(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes)
    effect = client.post(
        "/api/sound-effects",
        data={"name": "My automatic impact", "kind": "impact"},
        files={"file": ("hit.wav", wav_bytes(0.2), "audio/wav")},
    ).json()
    project = client.put(
        url + "/workspace",
        json=payload(project, workflow={"sound_choices": {"impact": effect["id"]}}),
    ).json()
    result = client.post(url + "/build-draft", json={})
    assert result.status_code == 200, result.text
    assert result.json()["scenes"][0]["sfx_id"] == effect["id"]
    assert (
        client.put(
            url + "/workspace",
            json=payload(project, workflow={"sound_choices": {"impact": "missing"}}),
        ).status_code
        == 422
    )
