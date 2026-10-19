import json
import math
import shutil
import sqlite3
import subprocess
import time
import wave

import pytest
from conftest import add_panel, add_project, wav_bytes

from app.audio import parse_srt, srt_text
from app.database import Project, RenderJob, Template, connect
from app.renderer import mix_audio, write_captions
from app.schemas import SceneInput, VideoSettings
from app.storage import LocalStorage


def test_upgrade_preserves_old_projects_templates_and_original_files(tmp_path):
    with sqlite3.connect(tmp_path / "studio.sqlite3") as db:
        db.executescript("""
            CREATE TABLE projects (id VARCHAR PRIMARY KEY, title VARCHAR, idea TEXT,
            status VARCHAR, script TEXT, script_approved BOOLEAN, narration_key VARCHAR,
            narration_duration FLOAT, settings JSON, revision INTEGER, created_at VARCHAR, updated_at VARCHAR);
            CREATE TABLE templates (id VARCHAR PRIMARY KEY, name VARCHAR, settings JSON);
        """)
        original = {
            "fps": 24,
            "transition": "fade",
            "captions": True,
            "default_duration": 5,
            "default_motion": "zoom_in",
        }
        db.execute(
            "INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                "old",
                "Keep my project",
                "Original idea",
                "ready",
                "Keep this joke",
                1,
                "narration/original.wav",
                75,
                json.dumps(original),
                9,
                "old-created",
                "old-updated",
            ),
        )
        db.execute(
            "INSERT INTO templates VALUES (?,?,?)",
            ("old-template", "Keep template", json.dumps(original)),
        )
    source = tmp_path / "source.png"
    source.write_bytes(b"original asset")
    for _ in range(2):
        engine, sessions = connect(tmp_path)
        with sessions() as db:
            project = db.get(Project, "old")
            assert (project.title, project.script, project.revision, project.narration_key) == (
                "Keep my project",
                "Keep this joke",
                9,
                "narration/original.wav",
            )
            assert project.caption_cues == [] and project.edit_history == {}
            assert project.logo_key is None and project.music_key is None
            assert db.get(Template, "old-template").name == "Keep template"
        engine.dispose()
    assert source.read_bytes() == b"original asset"


def payload(project, **changes):
    values = {
        "base_revision": project["revision"],
        "title": project["title"],
        "idea": project["idea"],
        "script": project["script"],
        "settings": project["settings"],
        "cues": project["caption_cues"],
        "scenes": [
            {key: value for key, value in scene.items() if key in SceneInput.model_fields}
            for scene in project["scenes"]
        ],
    }
    return {**values, **changes}


def populated(client, image_bytes, duration=2):
    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}"
    project = client.put(
        url + "/scenes", json={"scenes": [{"panel_id": panel["id"], "duration": duration}]}
    ).json()
    return project, url


def test_atomic_autosave_conflict_and_durable_undo_redo(client, image_bytes):
    project, url = populated(client, image_bytes)
    project = client.post(
        url + f"/scenes/{project['scenes'][0]['id']}/sfx",
        files={"file": ("hit.wav", wav_bytes(0.2), "audio/wav")},
    ).json()
    original = project["scenes"][0]
    response = client.put(
        url + "/workspace",
        json=payload(project, title="New title", script="Original joke", scenes=[]),
    )
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["scenes"] == [] and saved["can_undo"]
    assert (
        client.put(url + "/workspace", json=payload(project, title="Stale overwrite")).status_code
        == 409
    )
    restored = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert restored["scenes"][0]["id"] == original["id"]
    assert restored["scenes"][0]["sfx_url"] == original["sfx_url"]
    assert restored["can_redo"] and not restored["script_approved"]
    redone = client.post(url + "/history/redo", json={"base_revision": restored["revision"]}).json()
    assert redone["scenes"] == [] and redone["title"] == "New title"
    assert (
        client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).status_code
        == 409
    )
    current = client.get(url).json()
    assert current["revision"] == redone["revision"]
    # History is persisted in SQLite, rather than only in the browser.
    with client.app.state.sessions() as db:
        assert db.get(Project, project["id"]).edit_history["past"]


def test_workspace_validation_rolls_back_every_field(client, image_bytes):
    project, url = populated(client, image_bytes)
    other, _ = populated(client, image_bytes)
    foreign = payload(other)["scenes"]
    response = client.put(
        url + "/workspace", json=payload(project, title="Must not change", scenes=foreign)
    )
    assert response.status_code == 422
    current = client.get(url).json()
    assert current["title"] == project["title"] and current["revision"] == project["revision"]
    assert current["scenes"][0]["id"] == project["scenes"][0]["id"]
    assert (
        client.put(
            url + "/workspace", json=payload(project, cues=[{"start": 1, "end": 0.5, "text": "No"}])
        ).status_code
        == 422
    )


def test_history_is_bounded_and_new_edits_clear_redo(client, image_bytes):
    project, url = populated(client, image_bytes)
    for index in range(53):
        response = client.put(url + "/workspace", json=payload(project, title=f"Edit {index}"))
        assert response.status_code == 200
        project = response.json()
    with client.app.state.sessions() as db:
        assert len(db.get(Project, project["id"]).edit_history["past"]) == 50
    project = client.post(url + "/history/undo", json={"base_revision": project["revision"]}).json()
    assert project["can_redo"]
    project = client.put(
        url + "/workspace", json=payload(project, title="A different branch")
    ).json()
    assert not project["can_redo"]


def test_auto_edit_has_independent_pace_and_excerpt_length(client, image_bytes):
    project, url = populated(client, image_bytes, 8)
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(8), "audio/wav")}
    ).json()
    fast = client.post(url + "/auto-edit", json={"pace": "fast", "length": "full"})
    slow = client.post(url + "/auto-edit", json={"pace": "slow", "length": "full"})
    assert fast.status_code == slow.status_code == 200
    fast, slow = fast.json(), slow.json()
    assert len(fast["scenes"]) > len(slow["scenes"])
    assert fast["duration"] == slow["duration"] == 8
    assert all(scene["motion_strength"] >= 0.18 for scene in fast["scenes"])
    assert all(scene["motion_strength"] <= 0.12 for scene in slow["scenes"])
    assert len({scene["id"] for scene in fast["scenes"]}) == len(fast["scenes"])
    assert (
        client.get(url).json()["revision"] == project["revision"]
    )  # Preview never overwrites work.
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(35), "audio/wav")}
    ).json()
    for pace in ["fast", "slow"]:
        result = client.post(url + "/auto-edit", json={"pace": pace, "length": "short"}).json()
        assert result["duration"] == 30 and result["settings"]["narration_end"] == 30
        assert sum(round(scene["duration"] * 24) for scene in result["scenes"]) == 720


def test_waveform_and_silent_caption_generation(client, image_bytes):
    _, url = populated(client, image_bytes)
    assert client.get(url + "/waveform").status_code == 422
    client.post(url + "/narration", files={"file": ("silence.wav", wav_bytes(1), "audio/wav")})
    result = client.get(url + "/waveform").json()
    assert result["duration"] == 1 and max(result["peaks"]) == 0
    assert result["pauses"] == [[0, 1]]
    captions = client.post(url + "/captions/transcribe")
    assert captions.status_code == 200 and captions.json()["cues"] == []
    client.app.state.caption_lock.acquire()
    try:
        assert client.post(url + "/captions/transcribe").status_code == 409
    finally:
        client.app.state.caption_lock.release()


def test_script_caption_alignment_is_explicit_and_returns_an_unsaved_draft(
    client, image_bytes, monkeypatch
):
    _, url = populated(client, image_bytes)
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(1), "audio/wav")}).json()
    assert client.post(url + "/captions/transcribe", json={"use_script": True}).status_code == 422
    client.patch(url, json={"script": "Verdict wins"})
    received = []

    def recognizer(path, settings, script):
        received.append(script)
        return [{"start": 0, "end": 0.9, "text": script or "Recognized words"}]

    monkeypatch.setattr("app.api.transcribe", recognizer)
    response = client.post(url + "/captions/transcribe", json={"use_script": True})
    assert response.status_code == 200 and response.json()["cues"][0]["text"] == "Verdict wins"
    assert received == ["Verdict wins"]
    assert (
        client.get(url).json()["caption_cues"] == []
    )  # Recognition cannot overwrite an editor draft.


def test_srt_import_edit_export_and_safe_styling(client, image_bytes, tmp_path):
    project, url = populated(client, image_bytes)
    source = "1\n00:00:00,125 --> 00:00:00,875\nVERDICT hits hard\n"
    response = client.post(
        url + "/captions/import", files={"file": ("captions.srt", source.encode(), "text/plain")}
    )
    assert response.status_code == 200
    cues = response.json()["cues"]
    assert parse_srt(srt_text(cues)) == cues
    saved = client.put(url + "/workspace", json=payload(project, cues=cues)).json()
    assert saved["caption_cues"][0]["text"] == "VERDICT hits hard"
    assert "00:00:00,125" in client.get(url + "/captions/srt").text
    bad = source.replace("00:00:00,875", "00:00:00,001")
    assert (
        client.post(
            url + "/captions/import", files={"file": ("bad.srt", bad.encode(), "text/plain")}
        ).status_code
        == 422
    )
    settings = VideoSettings(
        caption_style="punchy", caption_color="#FFCC00", narration_start=0.5
    ).model_dump()
    target = tmp_path / "captions.ass"
    write_captions([{"duration": 1, "caption": ""}], 24, target, settings, cues)
    text = target.read_text()
    assert "0:00:00.00,0:00:00.38" in text and "HARD" in text
    assert "&H0000CCFF" in text


def test_brand_templates_keep_assets_and_reset_recording_selection(client, image_bytes):
    project, url = populated(client, image_bytes)
    logo = client.post(url + "/logo", files={"file": ("logo.png", image_bytes, "image/png")})
    assert logo.status_code == 200
    music = client.post(url + "/music", files={"file": ("music.wav", wav_bytes(1), "audio/wav")})
    assert music.status_code == 200
    project = music.json()
    settings = {
        **project["settings"],
        "narration_start": 2,
        "narration_end": 6,
        "caption_style": "box",
        "music_volume": 0.08,
    }
    template = client.post(
        "/api/templates",
        json={"name": "Brand kit", "settings": settings, "project_id": project["id"]},
    ).json()
    created = client.post(
        "/api/projects", json={"title": "Next episode", "template_id": template["id"]}
    ).json()
    assert (
        created["logo_url"] == project["logo_url"] and created["music_url"] == project["music_url"]
    )
    assert (
        created["settings"]["narration_start"] == 0 and created["settings"]["narration_end"] is None
    )
    assert created["settings"]["caption_style"] == "box"
    assert (
        client.post(
            url + "/logo", files={"file": ("bad.png", b"not an image", "image/png")}
        ).status_code
        == 422
    )


def wait_render(client, job):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"completed", "failed"}:
            assert job["status"] == "completed", job
            return job
        time.sleep(0.1)
    pytest.fail("Render timed out")


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_draft_and_final_export_with_excerpt_music_logo_and_timed_captions(
    client, image_bytes, settings
):
    project, url = populated(client, image_bytes, 1)
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(2), "audio/wav")}
    ).json()
    project = client.post(
        url + "/music", files={"file": ("music.wav", wav_bytes(0.4), "audio/wav")}
    ).json()
    project = client.post(
        url + "/logo", files={"file": ("logo.png", image_bytes, "image/png")}
    ).json()
    project = client.put(
        url + "/workspace",
        json=payload(
            project,
            script="Verdict wins.",
            settings={
                **project["settings"],
                "narration_start": 0.5,
                "narration_end": 1.5,
                "caption_style": "punchy",
            },
            cues=[{"start": 0.5, "end": 1.3, "text": "Verdict wins"}],
        ),
    ).json()
    assert client.post(url + "/renders").status_code == 422  # Final still requires approval.
    for quality, dimensions in [("draft", (360, 640)), ("final", (1080, 1920))]:
        if quality == "final":
            client.patch(url, json={"script_approved": True})
        response = client.post(url + "/renders", json={"quality": quality})
        assert response.status_code == 202, response.text
        job = wait_render(client, response.json())
        assert job["quality"] == quality
        with client.app.state.sessions() as db:
            output = settings.data_dir / db.get(RenderJob, job["id"]).output_key
        media = json.loads(
            subprocess.check_output(
                [settings.ffprobe, "-v", "error", "-show_streams", "-of", "json", str(output)],
                text=True,
            )
        )
        video = next(stream for stream in media["streams"] if stream["codec_type"] == "video")
        assert (video["width"], video["height"]) == dimensions
        assert int(video["nb_frames"]) == 24
        subprocess.run(
            [settings.ffmpeg, "-v", "error", "-i", str(output), "-f", "null", "-"],
            check=True,
            capture_output=True,
        )
        if quality == "draft":
            assert client.get(url).json()["status"] != "exported"


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_audio_ducking_reduces_music_during_narration(tmp_path, settings):
    def tone(path, frequency, gated=False):
        import array

        samples = array.array(
            "h",
            (
                int(5000 * math.sin(2 * math.pi * frequency * index / 16000))
                if not gated or 8000 <= index < 24000
                else 0
                for index in range(32000)
            ),
        )
        with wave.open(str(path), "wb") as stream:
            stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            stream.writeframes(samples.tobytes())

    storage = LocalStorage(tmp_path)
    tone(tmp_path / "voice.wav", 440, True)
    tone(tmp_path / "music.wav", 220)
    energies = []
    for duck in [False, True]:
        output = tmp_path / f"mix-{duck}.wav"
        values = VideoSettings(
            duck_audio=duck, normalize_voice=False, music_volume=0.8
        ).model_dump()
        snapshot = {"settings": values, "music_key": "music.wav", "scenes": [{"duration": 2}]}
        command = [
            settings.ffmpeg,
            "-y",
            "-v",
            "error",
            "-filter_complex_threads",
            "1",
            "-i",
            str(tmp_path / "voice.wav"),
            "-i",
            str(tmp_path / "voice.wav"),
        ]
        filters, _ = mix_audio(snapshot, storage, 2, command)
        command += [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[audio]",
            "-ar",
            "16000",
            "-ac",
            "1",
            str(output),
        ]
        subprocess.run(command, check=True, capture_output=True)
        _, samples = __import__("app.audio", fromlist=["pcm_audio"]).pcm_audio(output, settings)
        part = samples[16000:20000]
        energy = abs(
            sum(
                value * math.sin(2 * math.pi * 220 * index / 16000)
                for index, value in enumerate(part)
            )
        )
        energies.append(energy)
    assert energies[1] < energies[0] * 0.6
