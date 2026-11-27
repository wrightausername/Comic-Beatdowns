"""Original full-page fixtures → named crops → real draft, correction, Undo and ZIP."""

import copy
import hashlib
import io
import zipfile

import pytest
from conftest import add_project, wav_bytes
from PIL import Image
from test_director import enable, start, wait_job
from test_page_direction import wide_top
from test_workflow import payload

from app.database import Panel
from app.panel_organization import letters


def project_pages(client, image_bytes):
    project = add_project(client)
    url = "/api/projects/" + project["id"]
    out = io.BytesIO()
    wide_top().save(out, "PNG")
    for name, raw in [("ww_02.png", image_bytes), ("ww_01.png", out.getvalue())]:
        response = client.post(
            url + "/import-file", data={"kind": "panels"}, files={"file": (name, raw, "image/png")}
        )
        assert response.status_code == 201, response.text
        project = response.json()["project"]
    return project, url


def detect(client, project, url):
    response = client.post(
        url + "/panel-organization/preview", json={"base_revision": project["revision"]}
    )
    assert response.status_code == 200, response.text
    return response.json()["organization"]


def save(client, project, url, organization, **extra):
    response = client.put(
        url + "/panel-organization",
        json={"base_revision": project["revision"], "organization": organization, **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_detect_names_preview_is_repeatable_and_real_pngs_stay_grouped(client, image_bytes):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    assert detect(client, project, url) == organization
    assert [p["name"] for p in organization["pages"]] == ["ww_01", "ww_02"]
    assert [len(p["regions"]) for p in organization["pages"]] == [3, 1]
    assert organization["pages"][1]["review_required"]
    assert client.get(url).json() == project
    hashes = {}
    with client.app.state.sessions() as db:
        for page in organization["pages"]:
            panel = db.get(Panel, page["page_id"])
            hashes[panel.id] = hashlib.sha256(
                client.app.state.storage.path(panel.storage_key).read_bytes()
            ).hexdigest()
    saved = save(client, project, url, organization)
    assert saved["scene_count"] == 0 and saved["workflow"]["panel_organization"]["user_order"]
    response = client.get(url + "/panel-organization/download")
    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == [
            "ww_01/ww_01A.png",
            "ww_01/ww_01B.png",
            "ww_01/ww_01C.png",
            "ww_02/ww_02A.png",
        ]
        region = organization["pages"][0]["regions"][0]["crop"]
        panel_id = organization["pages"][0]["page_id"]
        with client.app.state.sessions() as db:
            source = db.get(Panel, panel_id)
            with (
                Image.open(client.app.state.storage.path(source.storage_key)) as original,
                Image.open(io.BytesIO(archive.read("ww_01/ww_01A.png"))) as cropped,
            ):
                box = (
                    round(region["x"] * original.width),
                    round(region["y"] * original.height),
                    round((region["x"] + region["width"]) * original.width),
                    round((region["y"] + region["height"]) * original.height),
                )
                assert cropped.size == original.crop(box).size
                assert cropped.tobytes() == original.crop(box).tobytes()
    with client.app.state.sessions() as db:
        for panel_id, expected in hashes.items():
            assert (
                hashlib.sha256(
                    client.app.state.storage.path(db.get(Panel, panel_id).storage_key).read_bytes()
                ).hexdigest()
                == expected
            )
    page_id = organization["pages"][1]["page_id"]
    response = client.get(url + "/panel-organization/download", params={"page_id": page_id})
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.namelist() == ["ww_02/ww_02A.png"]
    assert client.get(url + "/panel-organization/download?page_id=foreign").status_code == 404


def test_malformed_duplicate_foreign_and_stale_layouts_cannot_overwrite_saved_edit(
    client, image_bytes
):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    cases = []
    for change in ("path", "duplicate_name", "duplicate_id", "outside", "foreign"):
        bad = copy.deepcopy(organization)
        if change == "path":
            bad["pages"][0]["name"] = "../bad"
        if change == "duplicate_name":
            bad["pages"][1]["name"] = bad["pages"][0]["name"].upper()
        if change == "duplicate_id":
            bad["pages"][1]["regions"][0]["id"] = bad["pages"][0]["regions"][0]["id"]
        if change == "outside":
            bad["pages"][0]["regions"][0]["crop"] = dict(x=0.9, y=0, width=0.5, height=0.5)
        if change == "foreign":
            bad["pages"][0]["page_id"] = "foreign"
        cases.append(bad)
    for bad in cases:
        result = client.put(
            url + "/panel-organization",
            json={"base_revision": project["revision"], "organization": bad},
        )
        assert result.status_code == 422, result.text
    malformed = payload(project, workflow={"panel_organization": {"pages": "bad"}})
    assert client.put(url + "/workspace", json=malformed).status_code == 422
    assert client.get(url).json() == project
    saved = save(client, project, url, organization)
    assert (
        client.put(
            url + "/panel-organization",
            json={"base_revision": project["revision"], "organization": organization},
        ).status_code
        == 409
    )
    assert client.get(url).json() == saved


def test_named_crops_drive_actual_video_and_labels_survive_reframing_and_save(client, image_bytes):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    # Explicit creator order wins over geometry and later model/tag suggestions.
    organization["pages"][0]["regions"].reverse()
    project = save(client, project, url, organization)
    project = client.post(
        url + "/narration", files={"file": ("voice.wav", wav_bytes(6), "audio/wav")}
    ).json()
    project = enable(client, project)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    draft = client.get(url).json()
    assert draft["scene_count"] >= 4
    assert list(dict.fromkeys(s["source_label"] for s in draft["scenes"])) == [
        "ww_01A",
        "ww_01B",
        "ww_01C",
        "ww_02A",
    ]
    refs = {r["id"]: r["crop"] for p in organization["pages"] for r in p["regions"]}
    assert all(s["source_panel_ref"] in refs for s in draft["scenes"])
    assert {s["panel_id"] for s in draft["scenes"]} == {p["page_id"] for p in organization["pages"]}
    first = next(s for s in draft["scenes"] if s["source_label"] == "ww_01A")
    assert first["source_crop"] == organization["pages"][0]["regions"][0]["crop"]
    assert client.get(result["render"]["download_url"]).content[:4] != b"fail"
    assert result["render"]["work_report"]["inspected"]
    cut = client.post(url + "/auto-edit", json={"pace": "fast"}).json()
    assert all(s["source_label"] and s["source_panel_ref"] in refs for s in cut["scenes"])
    saved = client.put(
        url + "/workspace",
        json=payload(
            draft, scenes=cut["scenes"], settings=cut["settings"], workflow=draft["workflow"]
        ),
    ).json()
    assert saved["workflow"]["panel_organization"] == draft["workflow"]["panel_organization"]
    assert all(s["source_label"] for s in saved["scenes"])


def test_save_labels_existing_shots_without_changing_cameras_and_undo_is_exact(client, image_bytes):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    page = organization["pages"][0]
    project = client.put(
        url + "/scenes",
        json={
            "scenes": [
                dict(
                    panel_id=page["page_id"],
                    source_crop=r["crop"],
                    duration=1,
                    motion="hold",
                    locked=i == 0,
                )
                for i, r in enumerate(page["regions"])
            ]
        },
    ).json()
    before = copy.deepcopy(project)
    saved = save(client, project, url, organization)
    assert [s["source_label"] for s in saved["scenes"]] == ["ww_01A", "ww_01B", "ww_01C"]
    for old, new in zip(before["scenes"], saved["scenes"]):
        assert {k: v for k, v in old.items() if k not in ("source_label", "source_panel_ref")} == {
            k: v for k, v in new.items() if k not in ("source_label", "source_panel_ref")
        }
    reversed_layout = copy.deepcopy(organization)
    reversed_layout["pages"][0]["regions"].reverse()
    response = client.put(
        url + "/panel-organization",
        json={
            "base_revision": saved["revision"],
            "organization": reversed_layout,
            "reorder_video": True,
        },
    )
    assert response.status_code == 409
    restored = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert restored["scenes"] == before["scenes"] and restored["workflow"] == before["workflow"]


def test_panel_reorder_uses_stable_references_and_preserves_narration(client, image_bytes):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    page = organization["pages"][0]
    project = client.put(
        url + "/scenes",
        json={
            "scenes": [
                dict(panel_id=page["page_id"], source_crop=r["crop"], duration=i + 1, motion="hold")
                for i, r in enumerate(page["regions"])
            ]
        },
    ).json()
    project = save(client, project, url, organization)
    old = project["scenes"]
    organization["pages"][0]["regions"].reverse()
    renamed = save(client, project, url, organization)
    assert [s["id"] for s in renamed["scenes"]] == [s["id"] for s in old]
    assert [s["source_label"] for s in renamed["scenes"]] == ["ww_01C", "ww_01B", "ww_01A"]
    reordered = save(client, renamed, url, organization, reorder_video=True)
    assert [s["id"] for s in reordered["scenes"]] == [s["id"] for s in reversed(old)]
    assert (
        reordered["duration"] == project["duration"]
        and reordered["narration_url"] == project["narration_url"]
    )
    assert reordered["caption_cues"] == project["caption_cues"]
    assert letters(0) == "A" and letters(25) == "Z" and letters(26) == "AA"


def test_assistant_replacement_with_another_organized_crop_updates_its_label(client, image_bytes):
    project, url = project_pages(client, image_bytes)
    organization = detect(client, project, url)
    page = organization["pages"][0]
    project = client.put(
        url + "/scenes",
        json={
            "scenes": [
                dict(
                    panel_id=page["page_id"],
                    source_crop=page["regions"][0]["crop"],
                    duration=2,
                    motion="hold",
                )
            ]
        },
    ).json()
    project = save(client, project, url, organization)
    import json

    plan = dict(
        version=1,
        project_id=project["id"],
        base_revision=project["revision"],
        edits=[
            dict(
                scene_id=project["scenes"][0]["id"],
                changes={"source_crop": page["regions"][1]["crop"]},
            )
        ],
    )
    response = client.post(
        url + "/assistant/proposals",
        json={"base_revision": project["revision"], "text": json.dumps(plan)},
    )
    assert response.status_code == 201, response.text
    preview = client.get(url + "/assistant/proposals/" + response.json()["id"] + "/preview").json()
    assert preview["scenes"][0]["source_label"] == "ww_01B"
    assert preview["scenes"][0]["source_panel_ref"] == page["regions"][1]["id"]
    assert client.get(url).json()["scenes"][0]["source_label"] == "ww_01A"


@pytest.mark.parametrize("creator_saved", [False, True])
def test_explicit_vision_rebuild_refines_auto_crops_but_preserves_creator_layout(
    client, image_bytes, settings, monkeypatch, creator_saved
):
    from test_director import fake_render

    from app.schemas import VisionConnection
    from app.verdict_provider import VisionDirector, VisionPlan, save_connection

    project = add_project(client)
    url = "/api/projects/" + project["id"]
    for filename, content, kind in [
        ("ww_01.png", image_bytes, "panels"),
        ("voice.wav", wav_bytes(2), "narration"),
        ("words.srt", b"1\n00:00:00,000 --> 00:00:02,000\nAzure hits.\n", "captions"),
    ]:
        response = client.post(
            url + "/import-file", data={"kind": kind}, files={"file": (filename, content)}
        )
        assert response.status_code == 201, response.text
        project = response.json()["project"]
    fake_render(client, monkeypatch)
    project = enable(client, project)
    start(client, url, project)
    assert wait_job(client, url)["status"] == "completed"
    project = client.get(url).json()
    original = project["workflow"]["panel_organization"]
    assert len(original["pages"][0]["regions"]) == 1
    if creator_saved:
        project = save(client, project, url, original)
    save_connection(
        settings,
        VisionConnection(base_url="https://example.test/v1", model="mock", api_key="fixture-only"),
    )

    def plan(self, panels, cards, storage):
        return VisionPlan.model_validate(
            {
                "assignments": [{"panel_id": panels[0]["id"], "confidence": 0.9} for _ in cards],
                "page_layouts": [
                    {
                        "panel_id": panels[0]["id"],
                        "regions": [
                            dict(
                                x=0,
                                y=0,
                                width=1,
                                height=0.45,
                                confidence=0.9,
                                reason="Upper panel border",
                            ),
                            dict(
                                x=0,
                                y=0.55,
                                width=1,
                                height=0.45,
                                confidence=0.9,
                                reason="Lower panel border",
                            ),
                        ],
                    }
                ],
            }
        )

    monkeypatch.setattr(VisionDirector, "plan", plan)
    project = enable(client, project, mode="vision", rebuild_pages=True)
    start(client, url, project)
    result = wait_job(client, url)
    assert result["status"] == "completed", result
    rebuilt = client.get(url).json()
    count = len(rebuilt["workflow"]["panel_organization"]["pages"][0]["regions"])
    assert count == (1 if creator_saved else 2)
    if creator_saved:
        assert rebuilt["workflow"]["panel_organization"]["pages"] == original["pages"]
    else:
        assert {s["source_label"] for s in rebuilt["scenes"]} == {"ww_01A", "ww_01B"}
