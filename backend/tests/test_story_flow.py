from types import SimpleNamespace

import pytest
from PIL import Image, ImageDraw
from test_automation import fixture_project
from test_director import enable, fake_render, start, wait_job
from test_page_direction import Storage, item
from test_workflow import payload

from app.director import scene_focus
from app.page_direction import page_sources
from app.panel_detection import suggest_panels
from app.verdict_provider import PageLayout


@pytest.mark.parametrize("rebuild", [False, True])
def test_basic_director_keeps_page_order_despite_misleading_tag_matches(
    client, image_bytes, monkeypatch, rebuild
):
    project, url, first, second = fixture_project(client, image_bytes)
    if rebuild:
        project = client.put(
            url + "/workspace",
            json=payload(
                project,
                scenes=list(reversed(payload(project)["scenes"])),
                workflow={"panel_ids": [first["id"], second["id"]]},
            ),
        ).json()
    project = client.put(
        url + "/workspace",
        json=payload(
            project,
            workflow=project.get("workflow", {}),
            cues=[
                {"start": 0, "end": 3, "text": "Slate reveals a surprise."},
                {"start": 3, "end": 6, "text": "Azure punches hard!"},
            ],
        ),
    ).json()
    fake_render(client, monkeypatch)
    project = enable(client, project, rebuild_pages=rebuild)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    draft = client.get(url).json()
    ids = [s["panel_id"] for s in draft["scenes"]]
    assert list(dict.fromkeys(ids)) == [first["id"], second["id"]]
    assert all(ids[i] == first["id"] for i in range(ids.index(second["id"])))
    assert sum(s["duration"] for s in draft["scenes"]) == pytest.approx(6, abs=0.001)
    assert not draft["autopilot"].get("rebuild_pages", False)


def test_rebuilding_original_pages_refuses_to_replace_locked_shots(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes)
    scenes = payload(project)["scenes"]
    scenes[0]["locked"] = True
    project = client.put(url + "/workspace", json=payload(project, scenes=scenes)).json()
    project = enable(client, project, rebuild_pages=True)
    result = client.post(url + "/director", json={"base_revision": project["revision"]})
    assert result.status_code == 409
    assert client.get(url).json()["scenes"] == project["scenes"]


def test_staggered_column_gutters_do_not_read_down_one_column_first():
    page = Image.new("RGB", (1000, 1000), "white")
    draw = ImageDraw.Draw(page)
    for rect in [(8, 8, 460, 400), (8, 480, 460, 992), (540, 8, 992, 520), (540, 600, 992, 992)]:
        draw.rectangle(rect, fill="#253b55")
    regions = suggest_panels(page)
    assert len(regions) == 4
    assert regions[0]["x"] < 0.5 and regions[0]["y"] == 0
    assert regions[1]["x"] > 0.5 and regions[1]["y"] == 0
    assert regions[2]["x"] < 0.5 and regions[2]["y"] > 0
    assert regions[3]["x"] > 0.5 and regions[3]["y"] > 0


def layout(confidence=0.9):
    return PageLayout(
        panel_id="page",
        regions=[
            {
                "x": 0,
                "y": 0,
                "width": 1,
                "height": 0.4,
                "confidence": confidence,
                "reason": "Visible upper panel",
            },
            {
                "x": 0,
                "y": 0.4,
                "width": 1,
                "height": 0.6,
                "confidence": confidence,
                "reason": "Visible lower panel",
            },
        ],
    )


def test_vision_boundaries_crop_gutterless_page_without_changing_source(tmp_path):
    original = Image.new("RGB", (800, 1000), "#254267")
    parent = item("page", original, tmp_path)
    before = (tmp_path / "page.png").read_bytes()
    shots, report = page_sources([], [parent], Storage(tmp_path), [layout()])
    assert report["expanded"] and len(shots) == 2
    assert shots[0].source_crop == {"x": 0, "y": 0, "width": 1, "height": 0.4}
    assert shots[1].source_crop["y"] == 0.4
    assert (tmp_path / "page.png").read_bytes() == before


def test_uncertain_vision_boundaries_keep_whole_page(tmp_path):
    parent = item("page", Image.new("RGB", (800, 1000), "#254267"), tmp_path)
    shots, report = page_sources([], [parent], Storage(tmp_path), [layout(0.3)])
    assert len(shots) == 1 and shots[0].source_crop is None
    assert report["pages"][0]["review_required"]


def test_invalid_and_duplicate_panel_regions_are_rejected():
    value = layout().model_dump()
    value["regions"][0]["x"] = 0.6
    with pytest.raises(ValueError):
        PageLayout.model_validate(value)
    value = layout().model_dump()
    value["regions"][1] = value["regions"][0]
    with pytest.raises(ValueError):
        PageLayout.model_validate(value)


def test_full_page_focal_point_is_transformed_into_detected_panel_coordinates():
    shot = {"source_crop": {"x": 0.5, "y": 0, "width": 0.5, "height": 0.5}}
    panel = SimpleNamespace(width=800, height=1200)
    assert scene_focus(shot, panel, SimpleNamespace(target_x=0.75, target_y=0.25)) == (0.5, 0.5)
    assert scene_focus(shot, panel, SimpleNamespace(target_x=0.25, target_y=0.25)) is None
