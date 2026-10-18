import json
import shutil
import subprocess
import time

import pytest
from conftest import add_panel, add_project, wav_bytes
from PIL import Image

from app.database import RenderJob
from app.renderer import prepare_scene_image


def test_extreme_panel_aspect_ratio_has_a_bounded_render_frame(tmp_path):
    source, frame = tmp_path / "wide.png", tmp_path / "frame.png"
    Image.new("RGB", (4096, 2), "cyan").save(source)
    prepare_scene_image(source, frame)
    with Image.open(frame) as image:
        assert image.size == (1080, 1920)


@pytest.mark.render
@pytest.mark.skipif(
    not shutil.which("ffmpeg"), reason="FFmpeg is required for the render integration test"
)
def test_real_vertical_render_captions_fades_sfx_and_snapshot(client, image_bytes, settings):
    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}"
    result = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {
                    "panel_id": panel["id"],
                    "duration": 1,
                    "motion": "pan_left",
                    "caption": "The verdict is IN!",
                },
                {
                    "panel_id": panel["id"],
                    "duration": 1,
                    "motion": "zoom_out",
                    "caption": r"Literal {text} \ stays text",
                },
            ]
        },
    )
    assert result.status_code == 200
    scene_id = result.json()["scenes"][0]["id"]
    sfx = client.post(
        url + f"/scenes/{scene_id}/sfx", files={"file": ("effect.wav", wav_bytes(0.2), "audio/wav")}
    )
    assert sfx.status_code == 200
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(1.5), "audio/wav")})
    client.patch(url, json={"script": "That defense just left the chat. Verdict is in."})
    client.patch(url, json={"script_approved": True})
    response = client.post(url + "/renders")
    assert response.status_code == 202, response.text
    job = response.json()
    client.patch(url, json={"script": "This revision must not affect the queued video."})
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"failed", "completed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    assert job["progress"] == 100
    download = client.get(job["download_url"])
    assert download.status_code == 200
    assert download.headers["content-type"] == "video/mp4"
    assert len(download.content) > 10000
    with client.app.state.sessions() as db:
        output = settings.data_dir / db.get(RenderJob, job["id"]).output_key
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(output)],
        capture_output=True,
        text=True,
        check=True,
    )
    media = json.loads(result.stdout)
    video = next(s for s in media["streams"] if s["codec_type"] == "video")
    audio = next(s for s in media["streams"] if s["codec_type"] == "audio")
    assert (video["width"], video["height"], video["codec_name"]) == (1080, 1920, "h264")
    assert audio["codec_name"] == "aac"
    assert int(video["nb_frames"]) == 48
    assert float(video["duration"]) == pytest.approx(2, abs=0.001)
    assert float(media["format"]["duration"]) == pytest.approx(2, abs=0.03)
    # Decode every video/audio frame, not merely the container header.
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(output), "-f", "null", "-"],
        capture_output=True,
        check=True,
    )
    assert client.get(url).json()["status"] == "scripting"
