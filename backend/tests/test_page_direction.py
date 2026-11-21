"""Full-page virtual panel source and true image-based camera tests.

All artwork is original synthetic geometry. No copyrighted pages or remote AI.
"""

from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw

from app.autoedit import auto_edit
from app.effects import camera_expressions
from app.page_direction import glide_zoom, page_sources
from app.panel_detection import suggest_panels
from app.renderer import prepare_scene_image
from app.schemas import AutoEditInput, SceneInput


def wide_top():
    image = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 792, 312), fill="#152f45")
    draw.rectangle((8, 389, 370, 792), fill="#5b252b")
    draw.rectangle((438, 389, 792, 792), fill="#355c2c")
    return image


def tall_left():
    image = Image.new("RGB", (800, 800), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 320, 792), fill="#152f45")
    draw.rectangle((401, 8, 792, 353), fill="#5b252b")
    draw.rectangle((401, 432, 792, 792), fill="#355c2c")
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
        id=name, storage_key=filename, title=name, width=image.width,
        height=image.height, page=1,
    )


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
        SceneInput(panel_id="page", source_crop={"x": .9, "y": 0, "width": .2, "height": 1})
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
        18.0, AutoEditInput(pace="fast"), [],
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
