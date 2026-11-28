"""Whole pages become printed-panel crops, including large panels and scan gutters."""

import hashlib
import io
import zipfile

import pytest
from conftest import add_project
from PIL import Image, ImageColor, ImageDraw

from app.database import Panel
from app.panel_detection import suggest_panels

COLORS = ["#a74236", "#2e6e9a", "#b68c32", "#668542", "#7d498b"]


def nested_page(background="white", gap=16):
    image = Image.new("RGB", (1000, 1400), background)
    draw = ImageDraw.Draw(image)
    # One large top panel, one tall lower-left panel, three lower-right panels.
    boxes = [
        (10, 10, 990, 590),
        (10, 590 + gap, 480, 1390),
        (480 + gap, 590 + gap, 990, 970),
        (480 + gap, 970 + gap, 730, 1390),
        (730 + gap, 970 + gap, 990, 1390),
    ]
    for color, box in zip(COLORS, boxes):
        draw.rectangle(box, fill=color)
        x1, y1, x2, y2 = box
        draw.ellipse(
            (x1 + 30, y1 + 30, min(x2 - 20, x1 + 140), min(y2 - 20, y1 + 130)),
            outline="#171717",
            width=5,
        )
        draw.line((x1 + 20, y2 - 20, x2 - 20, y1 + 20), fill="#242424", width=3)
    return image


@pytest.mark.parametrize(
    "paper,gap,jpeg", [("white", 4, False), ("#ded4bc", 12, True), ("#161616", 8, False)]
)
def test_recursive_panel_detection_keeps_large_and_tall_printed_panels(paper, gap, jpeg):
    image = nested_page(paper, gap)
    if jpeg:
        out = io.BytesIO()
        image.save(out, "JPEG", quality=82)
        image = Image.open(io.BytesIO(out.getvalue())).convert("RGB")
    regions = suggest_panels(image)
    assert len(regions) == 5, regions
    # A wide/large printed panel is one region, not several camera-sized pieces.
    assert regions[0]["width"] > 0.95 and 0.4 < regions[0]["height"] < 0.45
    assert regions[1]["x"] == 0 and regions[1]["height"] > 0.5
    assert regions[2]["x"] > 0.45 and regions[2]["y"] < regions[3]["y"]
    assert regions[3]["x"] < regions[4]["x"] and regions[3]["y"] == regions[4]["y"]
    # Every crop contains the corresponding artwork, never the whole page again.
    for region, color in zip(regions, COLORS):
        x = round((region["x"] + region["width"] * 0.7) * image.width)
        y = round((region["y"] + region["height"] * 0.7) * image.height)
        assert (
            max(abs(a - b) for a, b in zip(image.getpixel((x, y)), ImageColor.getrgb(color))) < 15
        )


def test_single_large_illustration_stays_one_image():
    image = Image.new("RGB", (1000, 1400), "#284f72")
    draw = ImageDraw.Draw(image)
    draw.ellipse((40, 100, 960, 1300), outline="#c4a477", width=15)
    assert suggest_panels(image) == []


def test_saved_named_pngs_are_exact_source_crops_in_reading_order(client):
    image = nested_page("#ded4bc", 12)
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    raw = buffer.getvalue()
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    imported = client.post(
        url + "/import-file",
        data={"kind": "panels"},
        files={"file": ("ww_01.png", raw, "image/png")},
    )
    assert imported.status_code == 201, imported.text
    project = imported.json()["project"]
    # The existing library normalizes uploads to JPEG. Crops must preserve every
    # pixel of that stored source; cropping must not rewrite the source again.
    with client.app.state.sessions() as db:
        panel = db.get(Panel, project["workflow"]["panel_ids"][0])
        source_path = client.app.state.storage.path(panel.storage_key)
        before = hashlib.sha256(source_path.read_bytes()).hexdigest()
        with Image.open(source_path) as stored:
            image = stored.convert("RGB")
    preview = client.post(
        url + "/panel-organization/preview", json={"base_revision": project["revision"]}
    )
    assert preview.status_code == 200, preview.text
    organization = preview.json()["organization"]
    regions = organization["pages"][0]["regions"]
    assert len(regions) == 5
    saved = client.put(
        url + "/panel-organization",
        json={"base_revision": project["revision"], "organization": organization},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["scene_count"] == 0  # Cropping needs no narration/video build.
    downloaded = client.get(url + "/panel-organization/download")
    assert downloaded.status_code == 200, downloaded.text
    with zipfile.ZipFile(io.BytesIO(downloaded.content)) as archive:
        assert archive.namelist() == [f"ww_01/ww_01{letter}.png" for letter in "ABCDE"]
        for name, region in zip(archive.namelist(), regions):
            r = region["crop"]
            box = (
                round(r["x"] * image.width),
                round(r["y"] * image.height),
                round((r["x"] + r["width"]) * image.width),
                round((r["y"] + r["height"]) * image.height),
            )
            with Image.open(io.BytesIO(archive.read(name))) as crop:
                assert crop.size == image.crop(box).size
                assert crop.tobytes() == image.crop(box).tobytes()
    with client.app.state.sessions() as db:
        panel = db.get(Panel, organization["pages"][0]["page_id"])
        assert (
            hashlib.sha256(
                client.app.state.storage.path(panel.storage_key).read_bytes()
            ).hexdigest()
            == before
        )


def test_re_detect_replaces_whole_page_preview_without_touching_saved_video(client):
    from test_workflow import payload

    from app.panel_organization import FULL, crop_ref

    project = add_project(client)
    url = "/api/projects/" + project["id"]
    output = io.BytesIO()
    nested_page("#ded4bc", 12).save(output, "PNG")
    project = client.post(
        url + "/import-file",
        data={"kind": "panels"},
        files={"file": ("ww_01.png", output.getvalue(), "image/png")},
    ).json()["project"]
    page_id = project["workflow"]["panel_ids"][0]
    previous = {
        "version": 1,
        "user_order": False,
        "pages": [
            {
                "page_id": page_id,
                "name": "ww_01",
                "regions": [{"id": crop_ref(page_id, FULL), "crop": FULL}],
                "review_required": True,
                "reason": "Old detector kept the whole page",
            }
        ],
    }
    project = client.put(
        url + "/workspace",
        json=payload(project, workflow={**project["workflow"], "panel_organization": previous}),
    ).json()
    unchanged = client.post(
        url + "/panel-organization/preview", json={"base_revision": project["revision"]}
    ).json()
    assert len(unchanged["organization"]["pages"][0]["regions"]) == 1
    fresh = client.post(
        url + "/panel-organization/preview",
        json={"base_revision": project["revision"], "redetect": True},
    )
    assert fresh.status_code == 200, fresh.text
    assert len(fresh.json()["organization"]["pages"][0]["regions"]) == 5
    assert client.get(url).json() == project
