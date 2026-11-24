import json
import shutil
import subprocess
import time

import pytest
from conftest import add_panel, add_project, wav_bytes
from PIL import Image, ImageDraw
from sqlalchemy import select

from app.database import ReferenceStyle, RenderJob
from app.reference_style import allocate_frames
from app.renderer import scene_frames


@pytest.fixture
def reference_clip(tmp_path, settings):
    if not shutil.which(settings.ffmpeg):
        pytest.skip("FFmpeg is required")
    output = tmp_path / "original-reference.mp4"
    command = [settings.ffmpeg, "-v", "error", "-filter_complex_threads", "1"]
    for color, length in [("red", 1), ("white", 0.1), ("blue", 1), ("green", 1)]:
        command += ["-f", "lavfi", "-i", f"color=c={color}:s=160x90:r=20:d={length}"]
    command += [
        "-filter_complex",
        "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-y",
        str(output),
    ]
    subprocess.run(command, check=True, capture_output=True, timeout=30)
    return output.read_bytes()


def import_style(client, clip, **data):
    result = client.post(
        "/api/reference-styles", files={"file": ("reference.mp4", clip, "video/mp4")}, data=data
    )
    assert result.status_code == 201, result.text
    return result.json()


def tweak(client, style):
    result = client.put(
        f"/api/reference-styles/{style['id']}",
        json={
            "base_revision": style["revision"],
            "name": "Punchy reference",
            "recipe": {
                "beats": [
                    {"seconds": 0.5, "transition": "dip_white", "motion": "punch_in"},
                    {"seconds": 1, "transition": "crossfade", "motion": "impact_shake"},
                ],
                "motion_strength": 0.2,
                "transition_duration": 0.12,
            },
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def episode(client, image_bytes, protected=False):
    panel = add_panel(client, image_bytes)
    project = add_project(client)
    url = f"/api/projects/{project['id']}"
    shots = [
        {
            "panel_id": panel["id"],
            "duration": 2,
            "motion": "hold",
            "framing": "fit",
            "note": "Keep original creator note",
        }
        for _ in range(3)
    ]
    if protected:
        shots[1].update(locked=True)
        shots[2].update(
            camera_path=[{"x": 0.2, "y": 0.5}, {"x": 0.8, "y": 0.5}],
            source_crop={"x": 0.1, "y": 0.1, "width": 0.8, "height": 0.8},
        )
    client.put(url + "/scenes", json={"scenes": shots})
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(6), "audio/wav")})
    client.post(
        url + "/import-file",
        files={
            "file": (
                "words.srt",
                b"1\n00:00:00,000 --> 00:00:03,000\nOriginal recording words.\n",
                "text/plain",
            )
        },
        data={"kind": "captions"},
    )
    return url, client.get(url).json()


def propose(client, url, project, style, **options):
    return client.post(
        url + "/reference-style/proposals",
        json={
            "base_revision": project["revision"],
            "reference_id": style["id"],
            "reference_revision": style["revision"],
            "options": {
                "intensity": 1,
                "mapping": "loop",
                "minimum_hold": 0.25,
                "effects_per_minute": 120,
                "allow_flashes": True,
                "use_suggestions": True,
                "align_narration": False,
                **options,
            },
        },
    )


def test_local_analysis_measures_real_cuts_and_flash_without_mutating_projects(
    client, image_bytes, reference_clip, monkeypatch
):
    def network_forbidden(*args, **kwargs):
        pytest.fail("Local reference analysis must not call a remote writing provider")

    monkeypatch.setattr("httpx.post", network_forbidden)
    url, project = episode(client, image_bytes)
    style = import_style(client, reference_clip)
    assert {"dip_white", "cut"} <= {e["transition"] for e in style["analysis"]["events"]}
    assert all(e["approximate"] and e["evidence"] for e in style["analysis"]["events"])
    assert style["analysis"]["sample_fps"] == 10
    assert style["analysis"]["median_shot_seconds"] == pytest.approx(1, abs=0.15)
    assert "not identified or copied" in style["analysis"]["limits"]
    assert client.get(url).json() == project
    assert import_style(client, reference_clip)["id"] == style["id"]
    trimmed = import_style(client, reference_clip, start="0.5", end="2.5")
    assert trimmed["id"] != style["id"]
    assert trimmed["analysis"]["start"] == 0.5 and trimmed["analysis"]["end"] == 2.5
    assert all(0.5 <= e["source_time"] <= 2.5 for e in trimmed["analysis"]["events"])
    preview = client.get(style["video_url"], headers={"Range": "bytes=0-63"})
    assert preview.status_code == 206 and len(preview.content) == 64
    assert len(client.get("/api/reference-styles").json()) == 2


def test_real_gradual_blend_is_a_reviewable_crossfade_candidate(client, tmp_path, settings):
    if not shutil.which(settings.ffmpeg):
        pytest.skip("FFmpeg is required")
    path = tmp_path / "blend.mp4"
    subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-filter_complex_threads",
            "1",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=160x90:r=20:d=1.4",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=160x90:r=20:d=1.4",
            "-filter_complex",
            "[0:v][1:v]xfade=transition=fade:duration=0.4:offset=1[v]",
            "-map",
            "[v]",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(path),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    style = import_style(client, path.read_bytes())
    assert any(
        e["transition"] == "crossfade" and e["approximate"] for e in style["analysis"]["events"]
    )


def test_cut_detection_handles_shared_background_artwork(client, tmp_path, settings):
    if not shutil.which(settings.ffmpeg):
        pytest.skip("FFmpeg is required")
    inputs = []
    for color in ("red", "blue"):
        image = Image.new("RGB", (160, 90), "#cccccc")
        ImageDraw.Draw(image).rectangle((48, 20, 111, 69), fill=color)
        path = tmp_path / f"{color}.png"
        image.save(path)
        inputs += ["-loop", "1", "-framerate", "20", "-t", "1", "-i", str(path)]
    output = tmp_path / "shared-background.mp4"
    subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-filter_complex_threads",
            "1",
            *inputs,
            "-filter_complex",
            "[0:v][1:v]concat=n=2:v=1:a=0[v]",
            "-map",
            "[v]",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(output),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    style = import_style(client, output.read_bytes())
    assert any(
        e["transition"] == "cut" and abs(e["time"] - 1) < 0.15 for e in style["analysis"]["events"]
    )


def test_moving_reference_suggests_camera_direction(client, tmp_path, settings):
    if not shutil.which(settings.ffmpeg):
        pytest.skip("FFmpeg is required")
    image = Image.new("RGB", (320, 90), "#333333")
    draw = ImageDraw.Draw(image)
    for x in range(0, 320, 8):
        draw.rectangle((x, 0, x + 4, 89), fill=(x * 7 % 256, x * 13 % 256, x * 3 % 256))
    source = tmp_path / "original-motion.png"
    image.save(source)
    output = tmp_path / "pan.mp4"
    subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-filter_threads",
            "1",
            "-loop",
            "1",
            "-framerate",
            "20",
            "-i",
            str(source),
            "-t",
            "2",
            "-vf",
            "crop=160:90:x=n:y=0",
            "-c:v",
            "libx264",
            "-threads",
            "2",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(output),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    style = import_style(client, output.read_bytes())
    assert any(b["motion"] == "pan_right" for b in style["recipe"]["beats"])


def test_reference_proposal_preserves_locks_routes_sources_audio_and_undo(
    client, image_bytes, reference_clip
):
    url, original = episode(client, image_bytes, protected=True)
    style = tweak(client, import_style(client, reference_clip))
    result = propose(client, url, original, style)
    assert result.status_code == 201, result.text
    row = result.json()
    preview_url = url + f"/assistant/proposals/{row['id']}/preview"
    preview = client.get(preview_url).json()
    assert client.get(url).json() == original
    assert preview == client.get(preview_url).json()  # Added IDs are stable across previews/apply.
    assert len(preview["scenes"]) > len(original["scenes"])
    assert preview["scenes"][-2]["id"] == original["scenes"][1]["id"]
    assert preview["scenes"][-1]["camera_path"] == original["scenes"][2]["camera_path"]
    assert all(s["panel_id"] == original["scenes"][0]["panel_id"] for s in preview["scenes"])
    assert all("references/" not in s["panel"]["image_url"] for s in preview["scenes"])
    assert any(c["field"] == "Added editable shot" for c in row["changes"])
    assert any(s["transition"] == "dip_white" for s in preview["scenes"])
    assert any(s["motion"] == "impact_shake" for s in preview["scenes"])
    assert preview["caption_cues"] == original["caption_cues"]
    assert preview["narration_url"] == original["narration_url"]
    assert sum(scene_frames(s["duration"], 24) for s in preview["scenes"]) == 144
    applied = client.post(
        url + f"/assistant/proposals/{row['id']}/apply",
        json={"base_revision": original["revision"]},
    )
    assert applied.status_code == 200, applied.text
    saved = applied.json()
    for actual, before in zip(saved["scenes"][-2:], original["scenes"][1:]):
        assert {k: v for k, v in actual.items() if k != "position"} == {
            k: v for k, v in before.items() if k != "position"
        }
        old_start = sum(
            scene_frames(s["duration"], 24) for s in original["scenes"][: before["position"]]
        )
        new_start = sum(
            scene_frames(s["duration"], 24) for s in saved["scenes"][: actual["position"]]
        )
        assert old_start == new_start
    assert not saved["script_approved"]
    assert (
        client.post(
            url + f"/assistant/proposals/{row['id']}/apply",
            json={"base_revision": saved["revision"]},
        ).status_code
        == 409
    )
    undone = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert undone["scenes"] == original["scenes"]


def test_style_versions_scope_channels_and_invalid_plans_fail_closed(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = tweak(client, import_style(client, reference_clip))
    row = propose(
        client, url, project, style, first_shot=1, last_shot=1, pacing=False, camera=False
    ).json()
    candidate = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert candidate["scenes"][0]["transition"] == project["scenes"][0]["transition"]
    assert candidate["scenes"][2]["transition"] == project["scenes"][2]["transition"]
    assert candidate["scenes"][1]["transition"] == "dip_white"
    assert candidate["scenes"][1]["motion"] == project["scenes"][1]["motion"]
    assert [s["duration"] for s in candidate["scenes"]] == [2, 2, 2]
    updated = tweak(client, style)
    assert client.get(url + f"/assistant/proposals/{row['id']}/preview").status_code == 409
    assert (
        client.post(
            url + f"/assistant/proposals/{row['id']}/apply",
            json={"base_revision": project["revision"]},
        ).status_code
        == 409
    )
    assert (
        client.put(
            f"/api/reference-styles/{style['id']}",
            json={"base_revision": style["revision"], "name": "Stale", "recipe": style["recipe"]},
        ).status_code
        == 409
    )
    for options in [
        {"intensity": 0},
        {"first_shot": 2, "last_shot": 1},
        {"pacing": False, "camera": False, "transitions": False},
        {"tempo": 9},
        {"intensity": 0.5, "execute": "print('no')"},
    ]:
        assert propose(client, url, project, updated, **options).status_code == 422
    assert client.get(url).json() == project
    injected = {
        "base_revision": project["revision"],
        "text": json.dumps(
            {
                "kind": "reference_style",
                "project_id": project["id"],
                "base_revision": project["revision"],
                "workspace": {},
            }
        ),
    }
    assert client.post(url + "/assistant/proposals", json=injected).status_code == 422
    client.patch(url, json={"title": "New video revision"})
    assert propose(client, url, project, updated).status_code == 409


def test_sound_and_shot_caption_timing_survive_style_transfer(client, image_bytes, reference_clip):
    url, project = episode(client, image_bytes)
    effect = client.get("/api/sound-effects").json()[0]
    scenes = [
        {k: v for k, v in s.items() if k in {"id", "panel_id", "duration", "motion", "framing"}}
        for s in project["scenes"]
    ]
    scenes[0].update(sfx_id=effect["id"], sfx_offset=1.5)
    scenes[1]["caption"] = "Keep this shot caption with this shot."
    client.put(url + "/scenes", json={"scenes": scenes})
    project = client.get(url).json()
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style).json()
    result = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": project["revision"]}
    )
    assert result.status_code == 200, result.text
    saved = result.json()
    assert saved["scenes"][0]["duration"] == 2 and saved["scenes"][0]["sfx_offset"] == 1.5
    assert saved["scenes"][0]["sfx_id"] == effect["id"]
    assert (
        saved["scenes"][1]["duration"] == 2
        and saved["scenes"][1]["caption"] == scenes[1]["caption"]
    )
    assert sum(s["duration"] for s in saved["scenes"][:2]) == 4
    assert saved["caption_cues"] == project["caption_cues"]


def test_reference_errors_release_lock_and_private_routes_require_auth(
    client, reference_clip, monkeypatch
):
    for file_name, data in [("clip.txt", b"no"), ("clip.mp4", b"not a video"), ("empty.mp4", b"")]:
        assert (
            client.post("/api/reference-styles", files={"file": (file_name, data)}).status_code
            == 422
        )
    for fields in [{"start": "-1"}, {"start": "2", "end": "1"}, {"end": "181"}]:
        assert (
            client.post(
                "/api/reference-styles",
                files={"file": ("reference.mp4", reference_clip)},
                data=fields,
            ).status_code
            == 422
        )
    client.app.state.reference_lock.acquire()
    try:
        assert (
            client.post(
                "/api/reference-styles", files={"file": ("reference.mp4", reference_clip)}
            ).status_code
            == 409
        )
    finally:
        client.app.state.reference_lock.release()
    from app import reference_style

    analyzer = reference_style.analyze_reference

    def timeout(*args):
        raise subprocess.TimeoutExpired("ffmpeg", 75)

    monkeypatch.setattr(reference_style, "analyze_reference", timeout)
    result = client.post("/api/reference-styles", files={"file": ("reference.mp4", reference_clip)})
    assert result.status_code == 422 and "shorter" in result.text
    monkeypatch.setattr(reference_style, "analyze_reference", analyzer)
    style = import_style(client, reference_clip)
    client.headers.pop("Authorization")
    assert client.get("/api/reference-styles").status_code == 401
    assert client.get(style["video_url"]).status_code == 401


def test_frame_allocation_preserves_extreme_patterns_and_bounds():
    for total, weights, minimum, maximum in [
        (13, [100, 0.01, 0.01], 4, 6),
        (100, [1, 2, 8], 6, 50),
        (1920, [0.25] * 240, 8, 900),
        (30, [30, 0.25, 0.25], 8, 900),
    ]:
        values = allocate_frames(total, weights, minimum, maximum)
        assert sum(values) == total
        assert all(minimum <= n <= maximum for n in values)


def test_thirty_fps_half_frames_and_full_timeline_capacity_are_preserved(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = tweak(client, import_style(client, reference_clip))
    client.patch(url, json={"settings": {**project["settings"], "fps": 30}})
    panel_id = project["scenes"][0]["panel_id"]
    client.put(
        url + "/scenes",
        json={
            "scenes": [
                {"panel_id": panel_id, "duration": 0.35},
                {"panel_id": panel_id, "duration": 0.25, "locked": True},
                {"panel_id": panel_id, "duration": 0.4},
            ]
        },
    )
    project = client.get(url).json()
    row = propose(client, url, project, style).json()
    candidate = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert sum(scene_frames(s["duration"], 30) for s in candidate["scenes"]) == 31
    locked_index = next(i for i, s in enumerate(candidate["scenes"]) if s["locked"])
    assert sum(scene_frames(s["duration"], 30) for s in candidate["scenes"][:locked_index]) == 11
    client.put(
        url + "/scenes",
        json={"scenes": [{"panel_id": panel_id, "duration": 0.5} for _ in range(240)]},
    )
    project = client.get(url).json()
    row = propose(client, url, project, style, tempo=2).json()
    candidate = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert len(candidate["scenes"]) == 240
    assert sum(scene_frames(s["duration"], 30) for s in candidate["scenes"]) == 3600


@pytest.mark.render
def test_styled_timeline_renders_real_master_after_reference_is_deleted(
    client, image_bytes, reference_clip, settings
):
    url, project = episode(client, image_bytes)
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style).json()
    saved = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": project["revision"]}
    ).json()
    assert (
        client.request(
            "DELETE",
            f"/api/reference-styles/{style['id']}",
            json={"base_revision": style["revision"]},
        ).status_code
        == 200
    )
    with client.app.state.sessions() as db:
        assert db.scalar(select(ReferenceStyle)) is None
    queued = client.post(
        url + "/finish-export", json={"base_revision": saved["revision"], "reviewed": True}
    )
    assert queued.status_code == 202, queued.text
    job = queued.json()["job"]
    deadline = time.monotonic() + 75
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    with client.app.state.sessions() as db:
        render = db.get(RenderJob, job["id"])
        assert "references/" not in json.dumps(render.snapshot)
        output = client.app.state.storage.path(render.output_key)
    media = json.loads(
        subprocess.check_output(
            [settings.ffprobe, "-v", "error", "-show_streams", "-of", "json", str(output)],
            text=True,
        )
    )
    video = next(s for s in media["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"], int(video["nb_frames"])) == (1080, 1920, 144)
    subprocess.run(
        [settings.ffmpeg, "-v", "error", "-threads", "2", "-i", str(output), "-f", "null", "-"],
        check=True,
        capture_output=True,
        timeout=30,
    )
