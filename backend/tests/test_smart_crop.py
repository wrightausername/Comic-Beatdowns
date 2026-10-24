"""Page-splitting and editor preflight tests using original generated assets."""

import io

from PIL import Image, ImageDraw
from conftest import add_panel, add_project

from app.panel_detection import suggest_panels
from app.preflight import check_episode


def synthetic_page():
    image = Image.new("RGB", (600, 850), "white")
    paint = ImageDraw.Draw(image)
    # Two horizontally stacked illustrations with clear pale gutters.
    paint.rectangle((5, 6, 595, 385), fill="#264457")
    paint.rectangle((5, 458, 595, 846), fill="#6b3444")
    return image


def test_gutter_detector_separates_original_comic_page():
    image = synthetic_page()
    regions = suggest_panels(image)
    assert len(regions) == 2
    assert regions[0]["y"] < regions[1]["y"]
    assert regions[0]["height"] > 0.3
    assert regions[1]["height"] > 0.3
    assert all(0 <= rect["x"] <= 1 for rect in regions)


def test_gutter_detector_declines_gutterless_and_blank_pages():
    assert not suggest_panels(Image.new("RGB", (600, 850), "#123746"))
    assert not suggest_panels(Image.new("RGB", (600, 850), "white"))


def test_review_and_batch_crop_keep_original_unchanged(client):
    image = synthetic_page()
    output = io.BytesIO()
    image.save(output, "PNG")
    raw = output.getvalue()
    panel = add_panel(client, raw)
    url = f"/api/panels/{panel['id']}"
    r = client.get(url + "/smart-crops")
    assert r.status_code == 200, r.text
    choices = r.json()["candidates"]
    assert len(choices) == 2
    invalid = client.post(url + "/smart-crops", json={"indices": [50]})
    assert invalid.status_code == 422
    duplicate = client.post(url + "/smart-crops", json={"indices": [0, 0]})
    assert duplicate.status_code == 422
    created = client.post(url + "/smart-crops", json={"indices": [0, 1]})
    assert created.status_code == 201, created.text
    assert len(created.json()) == 2
    assert all(p["parent_id"] == panel["id"] for p in created.json())
    assert client.get(url + "/smart-crops").json()["candidates"] == choices
    assert panel["id"] in [p["id"] for p in client.get("/api/panels").json()]


def test_preflight_warns_about_timing_and_low_resolution():
    project = {
        "narration_url": "/voice.wav",
        "narration_duration": 10.0,
        "script": "The impact.",
        "settings": {"fps": 24, "narration_start": 0, "narration_end": 10, "captions": True},
        "caption_cues": [],
        "scenes": [
            {
                "duration": 0.2,
                "panel_id": "tiny",
                "motion": "zoom_in",
                "motion_strength": 0.3,
                "framing": "fill",
                "panel": {"title": "Impact", "width": 350, "height": 480},
            }
        ],
    }
    codes = {issue["code"] for issue in check_episode(project)}
    assert {"duration_mismatch", "captions_missing", "flash_cut", "low_resolution"} <= codes
    assert (
        not check_episode(
            {
                **project,
                "settings": {**project["settings"], "captions": False},
                "narration_duration": 0.2,
                "scenes": [
                    {
                        "duration": 0.2,
                        "panel_id": "tiny",
                        "motion": "hold",
                        "framing": "fit",
                        "panel": {"width": 350, "height": 480},
                    }
                ],
            }
        )
        == []
    )  # A 0.2-second shot is still too short.


def test_project_preflight_api_reports_clean_missing_requirements(client):
    project = add_project(client)
    response = client.get(f"/api/projects/{project['id']}/preflight")
    assert response.status_code == 200
    assert response.json()["critical"] >= 2
