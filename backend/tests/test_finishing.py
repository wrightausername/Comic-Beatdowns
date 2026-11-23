import json
import shutil
import subprocess
import time

import pytest
from conftest import add_panel, add_project, wav_bytes

from app.database import RenderJob
from app.finishing import scan_render


def episode(client, image_bytes):
    panel = add_panel(client, image_bytes)
    project = add_project(client)
    url = f"/api/projects/{project['id']}"
    client.put(
        url + "/scenes",
        json={
            "scenes": [
                {"panel_id": panel["id"], "duration": 1.5, "motion": "hold", "framing": "fit"}
            ]
        },
    )
    result = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(), "audio/wav")}
    )
    assert result.status_code == 200
    return url, client.get(url).json()


def test_finishing_requires_current_review_and_preserves_approval_on_failure(
    client, image_bytes, monkeypatch
):
    url, project = episode(client, image_bytes)
    check = client.get(url + "/finish-check")
    assert check.status_code == 200, check.text
    assert check.json()["critical"] == 0
    assert check.json()["scanned_render_id"] is None
    assert any(f["code"] == "full_review_needed" for f in check.json()["findings"])
    assert client.get(url).json() == project
    body = {"base_revision": project["revision"], "reviewed": False}
    assert client.post(url + "/finish-export", json=body).status_code == 422
    body["reviewed"] = True
    monkeypatch.setattr("app.api.tools_available", lambda _: False)
    assert client.post(url + "/finish-export", json=body).status_code == 503
    assert client.get(url).json() == project  # Approval rolled back with failed queueing.
    client.patch(url, json={"title": "Changed after review"})
    assert client.post(url + "/finish-export", json=body).status_code == 409


def test_finishing_blocks_missing_sources(client, image_bytes):
    url, project = episode(client, image_bytes)
    from app.database import Panel

    with client.app.state.sessions() as db:
        panel = db.get(Panel, project["scenes"][0]["panel_id"])
        client.app.state.storage.path(panel.storage_key).unlink()
    check = client.get(url + "/finish-check").json()
    assert check["critical"] > 0
    response = client.post(
        url + "/finish-export", json={"base_revision": project["revision"], "reviewed": True}
    )
    assert response.status_code == 422
    assert not client.get(url).json()["script_approved"]


def test_finishing_scans_only_full_current_revision(client, image_bytes, monkeypatch):
    url, project = episode(client, image_bytes)
    with client.app.state.sessions() as db:
        for revision, section in [
            (project["revision"], None),
            (project["revision"], {"start": 0, "end": 1}),
            (project["revision"] - 1, None),
        ]:
            job = RenderJob(
                project_id=project["id"],
                project_revision=revision,
                status="completed",
                snapshot={"section": section},
                output_key="exports/test.mp4",
            )
            db.add(job)
            db.flush()
            if revision == project["revision"] and section is None:
                expected_id = job.id
        db.commit()
    scanned = []

    def scan(path, settings, snapshot):
        scanned.append(snapshot)
        return [
            {
                "code": "silent_interval",
                "message": "Review silence",
                "seconds": 0,
                "severity": "warning",
                "scene_index": None,
            }
        ]

    monkeypatch.setattr("app.finishing.scan_render", scan)
    result = client.get(url + "/finish-check").json()
    assert result["scanned_render_id"] == expected_id
    assert scanned == [{"section": None}]
    assert any(f["code"] == "silent_interval" for f in result["findings"])

    def edit_while_scanning(*args):
        client.patch(url, json={"title": "Concurrent change"})
        return []

    monkeypatch.setattr("app.finishing.scan_render", edit_while_scanning)
    assert client.get(url + "/finish-check").status_code == 409


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_actual_black_silent_mp4_is_detected_locally(settings, tmp_path):
    path = tmp_path / "black-and-silent.mp4"
    subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=360x640:r=24:d=1.5",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=48000:cl=stereo",
            "-t",
            "1.5",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-c:a",
            "aac",
            "-y",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    findings = scan_render(
        path, settings, {"quality": "draft", "settings": {"fps": 24}, "scenes": [{"duration": 1.5}]}
    )
    assert {"black_interval", "silent_interval"} <= {f["code"] for f in findings}
    assert not any(f["severity"] == "critical" for f in findings)
    # The same file cannot masquerade as a 1080p master.
    findings = scan_render(
        path, settings, {"quality": "final", "settings": {"fps": 24}, "scenes": [{"duration": 1.5}]}
    )
    assert any(f["code"] == "render_dimensions" and f["severity"] == "critical" for f in findings)


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_explicit_finish_approval_queues_real_vertical_master(client, image_bytes, settings):
    url, project = episode(client, image_bytes)
    response = client.post(
        url + "/finish-export", json={"base_revision": project["revision"], "reviewed": True}
    )
    assert response.status_code == 202, response.text
    result = response.json()
    assert result["project"]["script_approved"]
    assert result["project"]["revision"] == project["revision"]
    assert result["project"]["scenes"] == project["scenes"]
    assert result["project"]["narration_url"] == project["narration_url"]
    job = result["job"]
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    with client.app.state.sessions() as db:
        path = client.app.state.storage.path(db.get(RenderJob, job["id"]).output_key)
    media = json.loads(
        subprocess.check_output(
            [settings.ffprobe, "-v", "error", "-show_streams", "-of", "json", str(path)], text=True
        )
    )
    video = next(s for s in media["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"]) == (1080, 1920)
    audio = next(s for s in media["streams"] if s["codec_type"] == "audio")
    assert int(audio["sample_rate"]) == 48000
    check = client.get(url + "/finish-check").json()
    assert check["scanned_render_id"] == job["id"]
    assert any(f["code"] == "silent_interval" for f in check["findings"]), check
    assert not any(f["code"] == "mix_peak" for f in check["findings"])
