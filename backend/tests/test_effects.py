import shutil
import sqlite3
import subprocess
from typing import get_args

import pytest
from conftest import add_panel, add_project
from PIL import Image

from app.database import Scene, connect
from app.effects import MOTIONS, Transition, incoming_transition
from app.renderer import probe, render_scene
from app.schemas import VideoSettings


def test_existing_scene_database_is_upgraded_without_losing_data(tmp_path):
    with sqlite3.connect(tmp_path / "studio.sqlite3") as connection:
        connection.executescript("""
            CREATE TABLE scenes (id VARCHAR PRIMARY KEY, project_id VARCHAR, panel_id VARCHAR,
            position INTEGER, duration FLOAT, motion VARCHAR, caption VARCHAR, sfx_key VARCHAR);
            INSERT INTO scenes VALUES ('existing-scene', 'existing-project', 'existing-panel',
            3, 8.5, 'pan_right', 'Keep this caption', 'sfx/existing.wav');
        """)
    asset = tmp_path / "original-panel.jpg"
    asset.write_bytes(b"existing source bytes")
    for _ in range(2):  # Upgrades are idempotent on subsequent launches.
        engine, sessions = connect(tmp_path)
        with sessions() as db:
            scene = db.get(Scene, "existing-scene")
            assert (scene.position, scene.duration, scene.caption, scene.sfx_key) == (
                3,
                8.5,
                "Keep this caption",
                "sfx/existing.wav",
            )
            assert scene.motion == "pan_right" and scene.easing == "linear"
            assert scene.motion_strength == 0.1 and scene.focus_x == scene.focus_y == 0.5
            assert scene.transition is None and scene.transition_duration is None
        engine.dispose()
    assert asset.read_bytes() == b"existing source bytes"


def test_camera_controls_roundtrip_and_validation(client, image_bytes):
    panel, project = add_panel(client, image_bytes), add_project(client)
    url = f"/api/projects/{project['id']}/scenes"
    values = {
        "panel_id": panel["id"],
        "duration": 2,
        "motion": "drift_up_right",
        "motion_strength": 0.16,
        "easing": "ease_out",
        "focus_x": 0.2,
        "focus_y": 0.8,
        "transition": "smooth_left",
        "transition_duration": 0.35,
    }
    response = client.put(url, json={"scenes": [values]})
    assert response.status_code == 200, response.text
    for key, value in values.items():
        assert response.json()["scenes"][0][key] == value
    saved = client.get(f"/api/projects/{project['id']}").json()["scenes"][0]
    assert saved["transition"] == "smooth_left" and saved["focus_y"] == 0.8
    for key, value in [
        ("motion", "spin"),
        ("transition", "glitch"),
        ("easing", "invalid"),
        ("motion_strength", 0.9),
        ("focus_x", -1),
        ("transition_duration", 10),
    ]:
        assert client.put(url, json={"scenes": [{**values, key: value}]}).status_code == 422


def test_transition_duration_caps_do_not_change_the_timeline():
    settings = VideoSettings(transition="crossfade", transition_duration=0.8).model_dump()
    assert incoming_transition({"duration": 0.25}, None, settings) == ("cut", 0)
    assert incoming_transition({"duration": 0.25}, {"duration": 10}, settings) == ("crossfade", 3)
    assert incoming_transition({"duration": 5, "transition": "cut"}, {"duration": 5}, settings) == (
        "cut",
        0,
    )


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required for media tests")
@pytest.mark.parametrize("motion", MOTIONS)
def test_every_camera_move_renders_with_framing_and_easing(tmp_path, settings, motion):
    image = tmp_path / "source.png"
    Image.new("RGB", (1080, 1920), "#298eac").save(image)
    easing = ["linear", "smooth", "ease_in", "ease_out"][MOTIONS.index(motion) % 4]
    scene = {
        "duration": 0.25,
        "motion": motion,
        "motion_strength": 0.2,
        "easing": easing,
        "focus_x": 0.2,
        "focus_y": 0.8,
    }
    output, tail = tmp_path / "scene.mp4", tmp_path / "tail.png"
    render_scene(scene, None, VideoSettings().model_dump(), settings, image, output, tail)
    media = probe(output, settings)
    assert media["duration"] == pytest.approx(0.25, abs=0.01)
    assert (media["streams"][0]["width"], media["streams"][0]["height"]) == (1080, 1920)
    with Image.open(tail) as frame:
        assert frame.size == (1080, 1920)


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required for media tests")
@pytest.mark.parametrize("effect", get_args(Transition))
def test_every_transition_renders_without_shortening_scenes(tmp_path, settings, effect):
    current, previous = tmp_path / "current.png", tmp_path / "previous.png"
    Image.new("RGB", (1080, 1920), "blue").save(current)
    Image.new("RGB", (1080, 1920), "red").save(previous)
    fps = 30 if effect.startswith("slide") else 24
    scene = {"duration": 0.5, "motion": "hold", "transition": effect, "transition_duration": 0.2}
    output = tmp_path / "scene.mp4"
    render_scene(
        scene,
        {"duration": 0.5},
        VideoSettings(fps=fps).model_dump(),
        settings,
        current,
        output,
        tmp_path / "tail.png",
        previous,
    )
    assert probe(output, settings)["duration"] == pytest.approx(0.5, abs=0.01)
    # Verify actual pixels at the boundary, not just a successful FFmpeg exit.
    count = round(0.5 * fps)
    result = subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-i",
            str(output),
            "-vf",
            f"select='eq(n,0)+eq(n,{count - 1})',scale=1:1",
            "-vsync",
            "0",
            "-pix_fmt",
            "rgb24",
            "-f",
            "rawvideo",
            "-",
        ],
        check=True,
        capture_output=True,
    )
    assert len(result.stdout) == 6
    first, last = result.stdout[:3], result.stdout[3:]
    assert last[2] > last[0] + 100  # Final frame is fully the incoming blue panel.
    if effect == "cut":
        assert first[2] > first[0] + 100
    else:
        assert first[0] > first[2] + 100  # A genuine transition starts on the outgoing red frame.
