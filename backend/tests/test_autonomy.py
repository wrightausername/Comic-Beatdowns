"""Real preview/recovery checks using original fixtures; no live provider calls."""

import copy
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from test_automation import fixture_project
from test_workflow import payload

from app.database import DirectorJob
from app.director import DirectorService
from app.render_cache import ShotCache
from app.renderer import RenderService
from app.story_planning import narration_map, sound_design, story_map, timed_cuts
from app.verdict_provider import PageLayout


def wait_render(client, job_id):
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        job = client.get("/api/renders/" + job_id).json()
        if job["status"] in ("completed", "failed"):
            assert job["status"] == "completed", job
            return job
        time.sleep(0.05)
    pytest.fail("Render did not complete")


def nine_shots(client, image_bytes):
    project, url, first, second = fixture_project(client, image_bytes, duration=9)
    shots = [
        dict(panel_id=(first if i % 2 else second)["id"], duration=1, motion="hold")
        for i in range(9)
    ]
    project = client.put(url + "/workspace", json=payload(project, scenes=shots)).json()
    return project, url


def test_alignment_does_not_invent_word_times():
    cues = [dict(start=1.2, end=2.5, text="Azure punches Slate")]
    original = copy.deepcopy(cues)
    result = narration_map("Azure kicks Slate twice", cues)
    assert result["precision"] == "phrase" and result["words"] == []
    assert result["script_coverage"] == 0.5 and result["review_required"]
    assert result["mismatches"] and cues == original


def test_authored_identity_survives_reframings_and_keeps_evidence():
    crop = dict(x=0.1, y=0.1, width=0.8, height=0.4)
    layout = PageLayout.model_validate(
        {
            "panel_id": "page",
            "regions": [
                {
                    **crop,
                    "confidence": 0.9,
                    "reason": "Visible upper border",
                    "characters": ["Azure"],
                    "dialogue": "Stop!",
                    "action": "Arm extends toward shield",
                },
                dict(
                    x=0.1,
                    y=0.55,
                    width=0.8,
                    height=0.4,
                    confidence=0.8,
                    reason="Visible lower border",
                ),
            ],
        }
    )
    page = SimpleNamespace(id="page")
    source = SimpleNamespace(panel_id="page", source_crop=crop)
    result = story_map([source, source], [page], [], [layout])
    assert len(result["panels"]) == 1
    panel = result["panels"][0]
    assert panel["dialogue"] == "Stop!" and panel["characters"] == ["Azure"]
    assert not panel["review_required"]
    assert story_map([source], [page], [], [layout])["panels"][0]["id"] == panel["id"]


def test_cut_roll_keeps_total_audio_and_protected_interval():
    scenes = [dict(id=str(i), duration=2, beat="custom") for i in range(4)]
    scenes[-1]["locked"] = True
    alignment = narration_map(
        "", [dict(start=3, end=5.3, text="Phrase one"), dict(start=5.3, end=7.1, text="Phrase two")]
    )
    changed = timed_cuts(scenes, dict(fps=30, narration_start=3), alignment, [], {"beats": []})
    assert changed[0]["after"] == pytest.approx(2.3)
    assert sum(round(s["duration"] * 30) for s in scenes) == 240
    assert scenes[-1] == dict(id="3", duration=2, beat="custom", locked=True)
    assert sum(round(s["duration"] * 30) for s in scenes[:-1]) == 180


def test_sound_rotation_quiet_reactions_and_manual_assets():
    scenes = [dict(id=str(i), duration=2, sfx_id=None) for i in range(4)]
    effects = [
        SimpleNamespace(id=str(i), name="User impact " + str(i), kind="impact") for i in range(2)
    ]
    beats = [
        {"start": i * 2, "beat": beat} for i, beat in enumerate(("hit", "hit", "reaction", "hit"))
    ]
    original = [SimpleNamespace(id="3", sfx_id="custom", sfx_key="sounds/custom.wav")]
    scenes[-1]["sfx_id"] = "custom"
    report = sound_design(scenes, effects, {}, {"beats": beats}, original)
    assert scenes[0]["sfx_id"] != scenes[1]["sfx_id"]
    assert scenes[2]["sfx_id"] is None and scenes[3]["sfx_id"] == "custom"
    assert any(r["asset"] is None for r in report)


def test_sequence_preview_render_apply_undo_and_stale_safety(client, image_bytes):
    project, url = nine_shots(client, image_bytes)
    response = client.post(
        url + "/assistant/proposals",
        json={
            "base_revision": project["revision"],
            "text": "Speed up the middle, keep the opening, let the final reaction breathe",
        },
    )
    assert response.status_code == 201, response.text
    proposal = response.json()
    assert {c.get("shot") for c in proposal["changes"]} == {4, 5, 6, 8, 9}
    base = url + "/assistant/proposals/" + proposal["id"]
    preview = client.get(base + "/preview").json()
    assert preview == client.get(base + "/preview").json()
    assert preview["scene_count"] == 12 and preview["duration"] == project["duration"]
    assert [
        {k: s[k] for k in original}
        for s, original in zip(preview["scenes"][:3], project["scenes"][:3])
    ] == project["scenes"][:3]
    assert preview["caption_cues"] == project["caption_cues"]
    assert client.get(url).json() == project
    render = client.post(base + "/render", json={"base_revision": project["revision"]})
    assert render.status_code == 202, render.text
    assert wait_render(client, render.json()["id"])["work_report"]["inspected"]
    changed = client.post(base + "/apply", json={"base_revision": project["revision"]})
    assert changed.status_code == 200, changed.text
    applied = changed.json()
    assert applied["scene_count"] == 12 and applied["narration_url"] == project["narration_url"]
    restored = client.post(
        url + "/history/undo", json={"base_revision": applied["revision"]}
    ).json()
    assert restored["scenes"] == project["scenes"]
    assert (
        client.post(base + "/apply", json={"base_revision": project["revision"]}).status_code == 409
    )


def test_sequence_keeps_locked_and_custom_routes(client, image_bytes):
    project, url = nine_shots(client, image_bytes)
    shots = payload(project)["scenes"]
    shots[4]["locked"] = True
    shots[5]["camera_path"] = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.8}]
    project = client.put(url + "/workspace", json=payload(project, scenes=shots)).json()
    response = client.post(
        url + "/assistant/proposals",
        json={"base_revision": project["revision"], "text": "Tighten the middle, keep the opening"},
    )
    assert response.status_code == 201, response.text
    preview = client.get(url + "/assistant/proposals/" + response.json()["id"] + "/preview").json()
    by_id = {s["id"]: s for s in preview["scenes"]}
    for i in (4, 5):
        original = project["scenes"][i]
        assert {k: by_id[original["id"]][k] for k in original if k != "position"} == {
            k: v for k, v in original.items() if k != "position"
        }
        index = next(j for j, s in enumerate(preview["scenes"]) if s["id"] == original["id"])
        assert sum(round(s["duration"] * 30) for s in preview["scenes"][:index]) == sum(
            round(s["duration"] * 30) for s in project["scenes"][:i]
        )
    assert (
        client.post(
            url + "/assistant/proposals",
            json={"base_revision": project["revision"], "text": "Speed up the villain or whatever"},
        ).status_code
        == 422
    )


def test_alternatives_deduplicate_render_and_reject_stale_apply(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes, duration=2)
    data = dict(base_revision=project["revision"], scene_id=project["scenes"][0]["id"])
    result = client.post(url + "/assistant/alternatives", json=data)
    assert result.status_code == 201, result.text
    options = result.json()["alternatives"]
    assert len(options) >= 2
    assert client.post(url + "/assistant/alternatives", json=data).json()["alternatives"] == options
    endpoint = url + "/assistant/proposals/" + options[0]["proposal"]["id"]
    result = client.post(endpoint + "/render", json={"base_revision": project["revision"]})
    assert result.status_code == 202, result.text
    assert wait_render(client, result.json()["id"])["work_report"]["inspected"]
    assert client.get(url).json() == project
    changed = client.put(url + "/workspace", json=payload(project, title="Newer edit")).json()
    assert (
        client.post(endpoint + "/apply", json={"base_revision": changed["revision"]}).status_code
        == 409
    )


def test_real_shot_cache_reuses_only_unchanged_content_and_detects_corruption(client, image_bytes):
    project, url, _, _ = fixture_project(client, image_bytes, duration=2)

    def render():
        return wait_render(
            client, client.post(url + "/renders", json={"quality": "draft"}).json()["id"]
        )

    assert render()["work_report"]["rendered_shots"] == 2
    assert render()["work_report"]["reused_shots"] == 2
    shots = payload(project)["scenes"]
    shots[0]["motion"] = "pan_down"
    project = client.put(url + "/workspace", json=payload(project, scenes=shots)).json()
    assert (
        render()["work_report"]["reused_shots"] == 0
    )  # Incoming blend depends on the changed tail.
    for path in ShotCache(client.app.state.storage).root.glob("*/video.mp4"):
        path.write_bytes(b"broken")
    assert render()["work_report"]["rendered_shots"] == 2
    assert client.get(url).json()["scenes"] == project["scenes"]


def test_bounded_repair_retries_once_then_stops(client, image_bytes, monkeypatch):
    project, url, _, _ = fixture_project(client, image_bytes, duration=1)
    renderer = client.app.state.renderer
    monkeypatch.setattr(renderer, "enqueue", lambda _: None)
    job_id = client.post(url + "/renders", json={"quality": "draft"}).json()["id"]
    original = renderer.render_once
    attempts = []

    def fail_once(job, bypass_cache=False):
        attempts.append(bypass_cache)
        if len(attempts) == 1:
            raise ValueError("Synthetic mux failure")
        original(job, bypass_cache)

    monkeypatch.setattr(renderer, "render_once", fail_once)
    renderer.render(job_id)
    assert len(wait_render(client, job_id)["work_report"]["repairs"]) == 1
    assert attempts == [False, True]

    def always_fail(*a, **k):
        raise ValueError("Persistent failure")

    monkeypatch.setattr(renderer, "render_once", always_fail)
    job_id = client.post(url + "/renders", json={"quality": "draft"}).json()["id"]
    renderer.render(job_id)
    failed = client.get("/api/renders/" + job_id).json()
    assert failed["status"] == "failed" and len(failed["work_report"]["repairs"]) == 2
    assert client.get(url).json()["scenes"] == project["scenes"]


def test_restart_resumes_immutable_render_and_keeps_newer_edit(client, image_bytes, monkeypatch):
    project, url, _, _ = fixture_project(client, image_bytes, duration=1)
    monkeypatch.setattr(client.app.state.renderer, "enqueue", lambda _: None)
    job_id = client.post(url + "/renders", json={"quality": "draft"}).json()["id"]
    changed = client.put(url + "/workspace", json=payload(project, title="Newer edit")).json()
    with ThreadPoolExecutor(max_workers=1) as executor:
        renderer = RenderService(
            client.app.state.settings, client.app.state.storage, client.app.state.sessions, executor
        )
        renderer.recover()
        result = wait_render(client, job_id)
    assert result["resume_count"] == 1 and result["project_revision"] == project["revision"]
    assert client.get(url).json() == changed


def test_director_resumes_local_work_without_resending_remote_calls(
    client, image_bytes, monkeypatch
):
    project, url, _, _ = fixture_project(client, image_bytes, duration=1)
    project = client.put(
        url + "/autopilot", json={"base_revision": project["revision"], "enabled": True}
    ).json()
    monkeypatch.setattr(client.app.state.director.executor, "submit", lambda *a: None)
    response = client.post(url + "/director", json={"base_revision": project["revision"]})
    assert response.status_code == 202, response.text
    local_id = response.json()["id"]
    with client.app.state.sessions() as db:
        saved = db.get(DirectorJob, local_id)
        remote = DirectorJob(
            project_id=project["id"],
            base_revision=project["revision"],
            snapshot={**saved.snapshot, "options": {"mode": "vision"}},
        )
        db.add(remote)
        db.commit()
        remote_id = remote.id
    service = DirectorService(client.app.state)
    service.start()
    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            service.sync_renders()
            with client.app.state.sessions() as db:
                job = db.get(DirectorJob, local_id)
                if job.status in ("completed", "failed"):
                    assert job.status == "completed", job.message
                    assert job.report["resume_count"] == 1 and job.report["story_map"]["panels"]
                    assert db.get(DirectorJob, remote_id).status == "failed"
                    break
            time.sleep(0.05)
        else:
            pytest.fail("Resumed director did not finish")
    finally:
        service.stop()


def test_observed_word_anchor_and_safe_chronological_region_placement():
    from app.story_planning import locate_spoken_events, place_story_artwork

    story = {
        "panels": [
            dict(id="upper", order=1, page_id="p", crop=dict(x=0, y=0, width=1, height=0.4))
        ],
        "beats": [
            dict(start=0, end=2, beat="hit", authored_panel_id="upper", review_required=False)
        ],
    }
    alignment = {"words": [dict(start=0.7, end=0.9, text="punches")]}
    locate_spoken_events(story, alignment)
    assert story["beats"][0]["event_time"] == 0.7
    scene = dict(panel_id="p", duration=2, source_crop=None)
    assert place_story_artwork([scene], {}, story) == []
    assert scene["source_crop"] == story["panels"][0]["crop"]
    protected = dict(panel_id="p", duration=2, source_crop=None, locked=True)
    place_story_artwork([protected], {}, story)
    assert protected["source_crop"] is None


def test_actual_inspection_repair_rechecks_mix_and_reports_gain(client, image_bytes, monkeypatch):
    import app.finishing as finishing
    from app.database import RenderJob

    project, url, _, _ = fixture_project(client, image_bytes, duration=1)
    scan = finishing.scan_render
    calls = []

    def peak_once(path, config, snapshot):
        calls.append(snapshot.get("mix_headroom"))
        return (
            [finishing.finding("mix_peak", "Synthetic near-zero peak")]
            if len(calls) == 1
            else scan(path, config, snapshot)
        )

    monkeypatch.setattr(finishing, "scan_render", peak_once)
    job = wait_render(client, client.post(url + "/renders", json={"quality": "draft"}).json()["id"])
    assert calls == [None, 0.84]
    assert "84%" in job["work_report"]["repairs"][0]["action"]
    with client.app.state.sessions() as db:
        assert db.get(RenderJob, job["id"]).snapshot["mix_headroom"] == 0.84
    assert client.get(url).json()["settings"] == project["settings"]


def test_background_preview_waits_for_director_and_checks_revision(
    client, image_bytes, monkeypatch
):
    project, url, _, _ = fixture_project(client, image_bytes, duration=1)
    project = client.put(
        url + "/autopilot", json={"base_revision": project["revision"], "enabled": True}
    ).json()
    monkeypatch.setattr(client.app.state.renderer, "enqueue", lambda _: None)
    with client.app.state.sessions() as db:
        job = DirectorJob(project_id=project["id"], base_revision=project["revision"], snapshot={})
        db.add(job)
        db.commit()
        job_id = job.id
    data = {"base_revision": project["revision"]}
    assert client.post(url + "/background-preview", json=data).status_code == 409
    with client.app.state.sessions() as db:
        db.get(DirectorJob, job_id).status = "cancelled"
        db.commit()
    response = client.post(url + "/background-preview", json=data)
    assert response.status_code == 202 and response.json()["quality"] == "draft"
    assert not client.get(url).json()["script_approved"]
    assert (
        client.post(
            url + "/background-preview", json={"base_revision": project["revision"] - 1}
        ).status_code
        == 409
    )


def test_sequence_split_keeps_timed_sound_and_longer_hold_avoids_truncating_it(client, image_bytes):
    project, url = nine_shots(client, image_bytes)
    scenes = payload(project)["scenes"]
    scenes[4].update(sfx_id="builtin-impact", sfx_offset=0.7)
    scenes[7].update(sfx_id="builtin-whoosh", sfx_offset=0.8)
    project = client.put(url + "/workspace", json=payload(project, scenes=scenes)).json()
    response = client.post(
        url + "/assistant/proposals",
        json={"base_revision": project["revision"], "text": "Speed up the middle"},
    )
    assert response.status_code == 201, response.text
    preview = client.get(url + "/assistant/proposals/" + response.json()["id"] + "/preview").json()
    cursor = 0
    sounds = []
    for scene in preview["scenes"]:
        if scene.get("sfx_url"):
            sounds.append(round(cursor + scene["sfx_offset"], 3))
        cursor += scene["duration"]
    assert 4.7 in sounds and 7.8 in sounds
    response = client.post(
        url + "/assistant/proposals",
        json={"base_revision": project["revision"], "text": "Let the final reaction breathe"},
    )
    assert response.status_code == 422 and "sound" in response.json()["detail"]
