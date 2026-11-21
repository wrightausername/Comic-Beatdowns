"""True editable 1→2→3 camera routes rendered to a vertical MP4."""

import math
import shutil
import subprocess

import pytest
from PIL import Image, ImageDraw

from app.camera_path import (
    focal_to_viewport,
    path_coordinate_expression,
    path_zoom,
    route_segments,
)
from app.effects import camera_expressions
from app.page_direction import glide_zoom
from app.renderer import prepare_scene_image, render_scene
from app.schemas import SceneInput


def scene(**updates):
    return {
        "panel_id": "page",
        "duration": 2.0,
        "motion": "panel_glide",
        "easing": "linear",
        "motion_strength": 0.1,
        "source_crop": {"x": 0, "y": 0, "width": 1, "height": 1},
        "camera_path": [
            {"x": 0.1, "y": 0.5},
            {"x": 0.5, "y": 0.5},
            {"x": 0.9, "y": 0.5},
        ],
        "path_move_fraction": 0.5,
        "path_zoom": 1.4,
        "glide_start": 0,
        "glide_end": 1,
        "source_aspect": 3.0,
        "focus_x": 0.5,
        "focus_y": 0.5,
        "transition": "cut",
        **updates,
    }


def test_camera_route_validation_rejects_invalid_points_and_speed():
    base = scene()
    valid = SceneInput.model_validate({k: v for k, v in base.items() if k in SceneInput.model_fields})
    assert len(valid.camera_path) == 3
    assert valid.path_move_fraction == 0.5
    for invalid in [
        {"camera_path": [{"x": 0.1, "y": 0.2}]},
        {"camera_path": [{"x": 0, "y": 0}] * 9},
        {"camera_path": [{"x": 0, "y": 0}, {"x": 1.2, "y": 0}]},
        {"path_move_fraction": 0},
        {"path_move_fraction": 1.5},
        {"path_zoom": 5},
    ]:
        with pytest.raises(ValueError):
            SceneInput.model_validate({
                **{k: v for k, v in base.items() if k in SceneInput.model_fields},
                **invalid,
            })


def test_waypoints_keep_viewport_inside_source_image():
    for aspect in (0.32, 0.75, 1.0, 3.0):
        zoom = path_zoom(aspect, 1.7)
        assert 1 <= zoom <= 8
        first = focal_to_viewport({"x": 0, "y": 0}, aspect, zoom)
        last = focal_to_viewport({"x": 1, "y": 1}, aspect, zoom)
        assert all(0 <= n <= 1 for n in (*first, *last))
        assert first[0] <= last[0]
        assert first[1] <= last[1]
    pts, breaks = route_segments(scene()["camera_path"], 3, path_zoom(3))
    assert len(pts) == 3
    assert breaks[0] == 0
    assert breaks[-1] == 1
    assert breaks[1] == pytest.approx(0.5)
    expr = path_coordinate_expression([p[0] for p in pts], breaks, "T")
    assert "if(lt(T," in expr


def test_render_expression_visits_ordered_route_then_holds():
    source = scene()
    source["glide_zoom"] = glide_zoom(source, 900, 300)
    assert source["glide_zoom"] == pytest.approx(path_zoom(3))
    zoom, x, y = camera_expressions(source, 48)
    assert zoom == str(source["glide_zoom"])
    assert "if(lt(" in x
    assert "if(lt(" in y
    assert "min(1," in x
    assert "/0.5" in x
    part = scene(glide_start=0.5, glide_end=1)
    part["glide_zoom"] = source["glide_zoom"]
    assert "0.5+(1-0.5)" in camera_expressions(part, 24)[1]


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_actual_three_stop_ffmpeg_pan_finishes_early_and_holds(tmp_path, settings):
    page = Image.new("RGB", (900, 300), "#c90000")
    draw = ImageDraw.Draw(page)
    draw.rectangle((300, 0, 599, 299), fill="#00b800")
    draw.rectangle((600, 0, 899, 299), fill="#0000ce")
    original, prepared = tmp_path / "original.png", tmp_path / "source.png"
    page.save(original)
    prepare_scene_image(
        original, prepared, framing="fit",
        size=(180, 320),
        source_crop={"x": 0, "y": 0, "width": 1, "height": 1},
    )
    shot = scene()
    shot["glide_zoom"] = glide_zoom(shot, 900, 300)
    output = tmp_path / "numbered-route.mp4"
    render_scene(
        shot, None, {"fps": 24, "transition": "cut"}, settings,
        prepared, output, tmp_path / "final-frame.png", size=(180, 320),
    )
    assert output.is_file() and output.stat().st_size > 1000
    frames = []
    for label, time_s in [("first", 0.04), ("mid", 0.51), ("end", 1.19), ("hold", 1.83)]:
        target = tmp_path / f"{label}.png"
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-v", "error", "-ss", str(time_s), "-i", str(output),
             "-frames:v", "1", str(target)],
            check=True, capture_output=True,
        )
        with Image.open(target) as image:
            frames.append(image.convert("RGB").getpixel((90, 160)))
    assert frames[0][0] > 125 and frames[0][2] < 70, frames
    assert frames[1][1] > 85, frames
    assert frames[2][2] > 125 and frames[2][0] < 80, frames
    assert frames[3][2] > 125 and frames[3][0] < 80, frames
    assert math.isfinite(shot["glide_zoom"])
