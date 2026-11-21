"""Full-page virtual panel source and true image-based camera tests.

All artwork is original synthetic geometry. No copyrighted pages or remote AI.
"""

import shutil
import subprocess
from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from app.autoedit import auto_edit
from app.effects import camera_expressions
from app.page_direction import glide_zoom, page_sources
from app.panel_detection import suggest_panels
from app.renderer import prepare_scene_image, render_scene
from app.schemas import AutoEditInput, SceneInput


def wide_top():
    image = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 792, 312), fill="#152f45")
    draw.rectangle((8, 365, 370, 792), fill="#5b252b")
    draw.rectangle((438, 365, 792, 792), fill="#355c2c")
    return image


def tall_left():
    image = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 320, 792), fill="#152f45")
    draw.rectangle((375, 8, 792, 353), fill="#5b252b")
    draw.rectangle((375, 403, 792, 792), fill="#355c2c")
    return image


class Storage:
    def __init__(self, folder):
        self.folder = folder

    def path(self, key):
        return self.folder / key


def item(name, image, tmp_path):
    filename = name + ".png"
    image.save(tmp_path / filename)
    return SimpleNamespace(
        id=name,
        storage_key=filename,
        title=name,
        width=image.width,
        height=image.height,
        page=1,
    )


def test_four_panel_page_creates_ordered_virtual_shots_from_one_source(tmp_path):
    page = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(page)
    draw.rectangle((8, 8, 350, 350), fill="#234c61")
    draw.rectangle((405, 8, 792, 350), fill="#654220")
    draw.rectangle((8, 405, 350, 792), fill="#52416b")
    draw.rectangle((405, 405, 792, 792), fill="#264d2e")
    parent = item("grid", page, tmp_path)

    shots, report = page_sources([], [parent], Storage(tmp_path))
    assert report["expanded"] is True
    assert len(shots) == 4
    assert [shot.panel_id for shot in shots] == ["grid"] * 4
    assert len({shot.id for shot in shots}) == 4
    coords = [shot.source_crop for shot in shots]
    assert coords[0]["y"] == coords[1]["y"]
    assert coords[0]["x"] < coords[1]["x"]
    assert coords[2]["y"] == coords[3]["y"]
    assert coords[0]["y"] < coords[2]["y"]


def test_wide_spanning_panel_is_one_composition(tmp_path):
    panel = item("wide", wide_top(), tmp_path)
    boxes = suggest_panels(wide_top())
    assert len(boxes) == 3
    assert boxes[0]["width"] > 0.95
    assert boxes[0]["height"] < 0.5
    result, report = page_sources([], [panel], Storage(tmp_path))
    assert report["expanded"] is True
    assert len(result) == 3
    assert {source.panel_id for source in result} == {"wide"}
    assert len({source.id for source in result}) == 3
    assert result[0].motion == "panel_glide"
    assert result[0].glide_axis == "horizontal"
    assert result[1].source_crop["x"] < result[2].source_crop["x"]


def test_tall_spanning_panel_is_not_split(tmp_path):
    panel = item("tall", tall_left(), tmp_path)
    result, report = page_sources([], [panel], Storage(tmp_path))
    assert len(result) == 3
    assert report["pages"][0]["panel_count"] == 3
    assert result[0].source_crop["height"] > 0.95
    assert result[0].motion == "panel_glide"
    assert result[0].glide_axis == "vertical"


def test_splash_and_locked_user_edit_are_preserved(tmp_path):
    splash = item("splash", Image.new("RGB", (800, 800), "#123746"), tmp_path)
    kept, report = page_sources([], [splash], Storage(tmp_path))
    assert len(kept) == 1
    assert kept[0].source_crop is None
    assert report["pages"][0]["review_required"]
    source = SimpleNamespace(id="locked", panel_id="splash", locked=True, source_crop=None)
    preserved, report = page_sources([source], [splash], Storage(tmp_path))
    assert preserved == [source]
    assert not report["expanded"]


def test_virtual_source_region_is_validated_and_cropped(tmp_path):
    with pytest.raises(ValueError):
        SceneInput(panel_id="page", source_crop={"x": 0.9, "y": 0, "width": 0.2, "height": 1})
    image = Image.new("RGB", (800, 800), "red")
    draw = ImageDraw.Draw(image)
    draw.rectangle((400, 0, 799, 799), fill="blue")
    path = tmp_path / "page.png"
    frame = tmp_path / "frame.png"
    image.save(path)
    rect = {"x": 0, "y": 0, "width": 0.49, "height": 1}
    prepare_scene_image(path, frame, size=(180, 320), framing="fit", source_crop=rect)
    with Image.open(frame) as selected:
        r, g, b = selected.getpixel((90, 160))
        assert r > 200 and b < 40
    assert glide_zoom({"motion": "panel_glide", "source_crop": rect}, 800, 800) >= 1


def test_repeated_glide_moves_forward_instead_of_restarting(tmp_path):
    panel = item("wide", wide_top(), tmp_path)
    sources, _ = page_sources([], [panel], Storage(tmp_path))
    # A long narration yields several shots per virtual source. The pan must
    # cross the long panel once, not loop back to the start at every edit cut.
    for source in sources:
        source.caption = ""
    cut = auto_edit(
        sources,
        {"fps": 24, "narration_start": 0, "narration_end": None, "edit_pace": "fast"},
        18.0,
        AutoEditInput(pace="fast"),
        [],
    )
    glides = [shot for shot in cut["scenes"] if shot["motion"] == "panel_glide"]
    assert len(glides) > 1
    assert glides[0]["glide_start"] == 0
    assert glides[-1]["glide_end"] == 1
    assert all(
        a["glide_end"] == pytest.approx(b["glide_start"], abs=0.00001)
        for a, b in zip(glides, glides[1:])
    )
    assert all(s["transition"] == "cut" for s in glides)
    zoom, x, y = camera_expressions({**glides[0], "glide_zoom": 2.4}, 32)
    assert zoom == "2.4"
    assert "iw" in x and "ih" in y


def test_detected_page_source_never_rewrites_existing_virtual_edit(tmp_path):
    panel = item("wide", wide_top(), tmp_path)
    sources, _ = page_sources([], [panel], Storage(tmp_path))
    unchanged, report = page_sources(sources, [panel], Storage(tmp_path))
    assert unchanged == sources
    assert not report["expanded"]


@pytest.mark.render
@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="FFmpeg is required")
def test_ffmpeg_glide_travels_across_single_wide_panel(tmp_path, settings):
    """Verify actual MP4 frames, not just computed camera expressions."""
    page = Image.new("RGB", (900, 300), "red")
    draw = ImageDraw.Draw(page)
    draw.rectangle((300, 0, 599, 299), fill="green")
    draw.rectangle((600, 0, 899, 299), fill="blue")
    original = tmp_path / "whole_page.png"
    prepared = tmp_path / "prepared.png"
    page.save(original)
    region = {"x": 0, "y": 0, "width": 1, "height": 1}
    prepare_scene_image(
        original,
        prepared,
        size=(180, 320),
        framing="fit",
        source_crop=region,
    )
    shot = {
        "duration": 1.0,
        "motion": "panel_glide",
        "motion_strength": 0.1,
        "easing": "linear",
        "glide_axis": "horizontal",
        "glide_start": 0,
        "glide_end": 1,
        "glide_zoom": glide_zoom({"motion": "panel_glide", "source_crop": region}, 900, 300),
        "focus_x": 0.5,
        "focus_y": 0.5,
        "transition": "cut",
    }
    video = tmp_path / "scene.mp4"
    render_scene(
        shot,
        None,
        {"fps": 24, "transition": "cut"},
        settings,
        prepared,
        video,
        tmp_path / "tail.png",
        size=(180, 320),
    )
    assert video.is_file() and video.stat().st_size > 1000
    first, last = tmp_path / "first.png", tmp_path / "last.png"
    for moment, output in [(0.03, first), (0.95, last)]:
        subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-ss",
                str(moment),
                "-i",
                str(video),
                "-frames:v",
                "1",
                "-y",
                str(output),
            ],
            check=True,
            capture_output=True,
        )
    with Image.open(first) as start, Image.open(last) as finish:
        r1, _, b1 = start.getpixel((90, 160))
        r2, _, b2 = finish.getpixel((90, 160))
        assert r1 > 160 and b1 < 100
        assert b2 > 160 and r2 < 100
