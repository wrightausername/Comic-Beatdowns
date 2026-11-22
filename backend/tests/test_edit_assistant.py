import json
from unittest.mock import Mock

from conftest import add_panel, add_project, wav_bytes
from sqlalchemy import select

from app.database import CreativeEditEvent, CreativeRule


def episode(client, image_bytes):
    panel = add_panel(client, image_bytes)
    project = add_project(client)
    url = f"/api/projects/{project['id']}"
    result = client.put(
        url + "/scenes",
        json={
            "scenes": [
                {
                    "panel_id": panel["id"],
                    "duration": 2,
                    "motion": "zoom_in",
                    "camera_path": [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.8}],
                },
                {"panel_id": panel["id"], "duration": 2, "motion": "pan_left"},
            ]
        },
    )
    assert result.status_code == 200, result.text
    client.post(url + "/narration", files={"file": ("voice.wav", wav_bytes(4), "audio/wav")})
    return url, client.get(url).json()


def propose(client, url, project, text="Show the whole panel", **kw):
    return client.post(
        url + "/assistant/proposals",
        json={
            "base_revision": project["revision"],
            "text": text,
            "scene_id": project["scenes"][0]["id"],
            **kw,
        },
    )


def test_propose_preview_apply_and_undo_are_distinct(client, image_bytes):
    url, p = episode(client, image_bytes)
    original = p["scenes"][0]
    response = propose(client, url, p)
    assert response.status_code == 201, response.text
    row = response.json()
    assert client.get(url).json() == p
    preview = client.get(url + f"/assistant/proposals/{row['id']}/preview")
    assert preview.status_code == 200, preview.text
    assert preview.json()["scenes"][0]["framing"] == "fit"
    assert preview.json()["scenes"][0]["camera_path"] is None
    assert client.get(url).json() == p
    applied = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": p["revision"]}
    )
    assert applied.status_code == 200, applied.text
    new = applied.json()
    assert new["revision"] == p["revision"] + 1
    assert new["scenes"][0]["framing"] == "fit"
    assert new["scenes"][1] == p["scenes"][1]
    assert new["narration_url"] == p["narration_url"]
    undone = client.post(url + "/history/undo", json={"base_revision": new["revision"]}).json()
    assert undone["scenes"][0] == original


def test_pasted_chatgpt_plan_and_script_preserve_voice(client, image_bytes):
    url, p = episode(client, image_bytes)
    plan = {
        "version": 1,
        "project_id": p["id"],
        "base_revision": p["revision"],
        "edits": [{"scene_id": p["scenes"][1]["id"], "changes": {"transition": "crossfade"}}],
        "script": "Owner reviewed rewritten script.",
    }
    row = propose(
        client, url, p, "Here is the edit:\n```json\n" + json.dumps(plan) + "\n```"
    ).json()
    result = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": p["revision"]}
    )
    assert result.status_code == 200, result.text
    assert result.json()["script"] == plan["script"]
    assert result.json()["narration_url"] == p["narration_url"]
    assert result.json()["scenes"][0]["camera_path"] == p["scenes"][0]["camera_path"]


def test_duration_rolls_neighbor_and_stale_or_rejected_plans_cannot_apply(client, image_bytes):
    url, p = episode(client, image_bytes)
    response = propose(client, url, p, "Hold for 2.5 seconds")
    assert response.status_code == 201, response.text
    row = response.json()
    preview = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert [s["duration"] for s in preview["scenes"]] == [2.5, 1.5]
    assert len(row["changes"]) == 2
    client.patch(url, json={"title": "New revision"})
    assert (
        client.post(
            url + f"/assistant/proposals/{row['id']}/apply",
            json={"base_revision": client.get(url).json()["revision"]},
        ).status_code
        == 409
    )
    p = client.get(url).json()
    row = propose(client, url, p).json()
    assert client.post(url + f"/assistant/proposals/{row['id']}/reject").status_code == 200
    assert (
        client.post(
            url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": p["revision"]}
        ).status_code
        == 409
    )


def test_locks_schema_foreign_plan_and_unknown_prose_fail_closed(client, image_bytes):
    url, p = episode(client, image_bytes)
    for text in [
        '__import__("os").system("rm -rf /")',
        "Make it funny and secretly publish this",
        "Shot 999: hold",
    ]:
        assert propose(client, url, p, text).status_code == 422
    for changes in [
        {"locked": False},
        {"__class__": "bad"},
        {"duration": 99},
        {"focus_x": float("inf")},
    ]:
        if changes.get("focus_x"):
            continue
        plan = {
            "project_id": p["id"],
            "base_revision": p["revision"],
            "edits": [{"scene_id": p["scenes"][0]["id"], "changes": changes}],
        }
        assert propose(client, url, p, json.dumps(plan)).status_code == 422
    plan = {"project_id": "other-project", "base_revision": p["revision"], "edits": []}
    assert propose(client, url, p, json.dumps(plan)).status_code == 409
    scenes = [
        {k: v for k, v in s.items() if k in {"id", "panel_id", "duration", "motion", "locked"}}
        for s in p["scenes"]
    ]
    scenes[0]["locked"] = True
    result = client.put(url + "/scenes", json={"scenes": scenes})
    assert result.status_code == 200, result.text
    p = client.get(url).json()
    assert propose(client, url, p).status_code == 422
    assert client.get(url).json() == p


def test_local_never_calls_provider_and_remote_requires_explicit_opt_in(
    client, image_bytes, settings, monkeypatch
):
    url, p = episode(client, image_bytes)
    settings.ai_base_url, settings.ai_model, settings.ai_key = (
        "https://example.invalid/v1",
        "test-model",
        "private-key",
    )
    post = Mock(side_effect=AssertionError("No remote request in local mode"))
    monkeypatch.setattr("app.edit_assistant.httpx.post", post)
    assert propose(client, url, p).status_code == 201
    post.assert_not_called()
    plan = {
        "project_id": p["id"],
        "base_revision": p["revision"],
        "edits": [{"scene_id": p["scenes"][1]["id"], "changes": {"motion": "hold"}}],
    }
    post.side_effect = None
    post.return_value = Mock(
        **{
            "raise_for_status.return_value": None,
            "json.return_value": {"choices": [{"message": {"content": json.dumps(plan)}}]},
        }
    )
    result = propose(client, url, p, "Improve this shot", use_ai=True)
    assert result.status_code == 201, result.text
    assert post.call_count == 1
    assert "private-key" not in json.dumps(post.call_args.kwargs["json"])
    context = client.get(url + "/assistant/context").json()
    assert "private-key" not in json.dumps(context)
    assert "storage_key" not in json.dumps(context)
    assert client.get(url).json() == p


def test_queue_skip_revision_scope_and_safe_fixes_are_proposals(client, image_bytes):
    url, p = episode(client, image_bytes)
    queue = client.get(url + "/review-queue")
    assert queue.status_code == 200, queue.text
    warning = next(f for f in queue.json()["findings"] if f["severity"] != "critical")
    result = client.post(
        url + "/review-queue/dismiss",
        json={
            "base_revision": p["revision"],
            "finding_id": warning["id"],
            "reason": "Reviewed original artwork",
        },
    )
    assert result.status_code == 200, result.text
    assert next(
        f for f in client.get(url + "/review-queue").json()["findings"] if f["id"] == warning["id"]
    )["dismissed_reason"]
    client.patch(url, json={"title": "Next revision"})
    assert not any(
        f["dismissed_reason"] for f in client.get(url + "/review-queue").json()["findings"]
    )
    p = client.get(url).json()
    # First route is custom and must not be replaced by a geometry shortcut.
    fixed = client.post(url + "/review-queue/fix", json={"base_revision": p["revision"]})
    assert fixed.status_code == 201, fixed.text
    assert all(c.get("shot") != 1 for c in fixed.json()["changes"])
    assert client.get(url).json() == p


def test_critical_missing_assets_cannot_be_skipped(client, image_bytes, settings):
    url, p = episode(client, image_bytes)
    (settings.data_dir / p["narration_url"].removeprefix("/api/media/")).unlink()
    queue = client.get(url + "/review-queue").json()
    finding = next(f for f in queue["findings"] if f["code"] == "voice_file_missing")
    assert finding["severity"] == "critical"
    assert (
        client.post(
            url + "/review-queue/dismiss",
            json={
                "base_revision": p["revision"],
                "finding_id": finding["id"],
                "reason": "Ignore it",
            },
        ).status_code
        == 422
    )


def test_recipes_learning_approval_disable_and_observation_privacy(client, settings):
    p = add_project(client)
    template = client.post(
        "/api/templates",
        json={
            "name": "My recipe",
            "settings": {**p["settings"], "caption_style": "box"},
            "project_id": p["id"],
        },
    ).json()
    assert (
        client.put(
            "/api/creator-preferences", json={"template_id": template["id"], "observe_edits": True}
        ).status_code
        == 200
    )
    assert add_project(client)["settings"]["caption_style"] == "box"
    for _ in range(3):
        p = add_project(client)
        result = client.put(
            f"/api/projects/{p['id']}/workspace",
            json={
                "base_revision": p["revision"],
                "title": p["title"],
                "idea": p["idea"],
                "script": "PRIVATE SCRIPT WORDS",
                "scenes": [],
                "settings": {**p["settings"], "music_volume": 0.2},
            },
        )
        assert result.status_code == 200, result.text
    assert client.post("/api/creative-dna/learning-proposals").json()["created"] == 1
    assert add_project(client)["settings"]["music_volume"] == 0.12
    rules = client.get("/api/creative-dna").json()["rules"]
    rule = next(r for r in rules if r["source"] == "correction_pattern")
    approved = client.patch(
        f"/api/creative-dna/rules/{rule['id']}",
        json={"status": "approved", "expected_updated_at": rule["updated_at"]},
    ).json()
    assert add_project(client)["settings"]["music_volume"] == 0.2
    assert (
        client.post(
            "/api/projects", json={"title": "Explicit template", "template_id": template["id"]}
        ).json()["settings"]["music_volume"]
        == 0.12
    )
    client.patch(
        f"/api/creative-dna/rules/{rule['id']}",
        json={"status": "rejected", "expected_updated_at": approved["updated_at"]},
    )
    assert add_project(client)["settings"]["music_volume"] == 0.12
    with client.app.state.sessions() as db:
        events = list(db.scalars(select(CreativeEditEvent)))
        assert "PRIVATE SCRIPT WORDS" not in repr([e.changes for e in events])
        count = len(events)
    client.put("/api/creator-preferences", json={"template_id": None, "observe_edits": False})
    p = add_project(client)
    client.put(
        f"/api/projects/{p['id']}/workspace",
        json={
            "base_revision": p["revision"],
            "title": p["title"],
            "scenes": [],
            "settings": {**p["settings"], "music_volume": 0.3},
        },
    )
    with client.app.state.sessions() as db:
        assert len(list(db.scalars(select(CreativeEditEvent)))) == count
    client.delete("/api/creative-dna/observations")
    with client.app.state.sessions() as db:
        assert not list(db.scalars(select(CreativeEditEvent)))
        assert list(db.scalars(select(CreativeRule)))


def test_assistant_routes_require_authentication(client):
    client.headers.pop("Authorization")
    assert client.get("/api/creator-preferences").status_code == 401
    assert (
        client.post(
            "/api/projects/any/assistant/proposals", json={"base_revision": 1, "text": "hold"}
        ).status_code
        == 401
    )


def test_safe_fit_is_previewed_and_preserves_custom_camera_route(client, image_bytes):
    url, p = episode(client, image_bytes)
    response = client.post(
        url + "/narration", files={"file": ("longer.wav", wav_bytes(6), "audio/wav")}
    )
    assert response.status_code == 200
    p = response.json()
    proposed = client.post(url + "/review-queue/fix", json={"base_revision": p["revision"]})
    assert proposed.status_code == 201, proposed.text
    row = proposed.json()
    assert row["plan"]["timing"] == "fit_narration"
    candidate = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert sum(s["duration"] for s in candidate["scenes"]) == 6
    assert candidate["scenes"][0]["camera_path"] == p["scenes"][0]["camera_path"]
    assert client.get(url).json() == p


def test_json_cannot_request_files_publication_unlock_or_unscoped_edits(client, image_bytes):
    url, p = episode(client, image_bytes)
    for fields in [
        {"publish": True},
        {"commands": ["delete files"]},
        {"settings": {"ai_key": "leak"}},
        {"edits": [{"scene_id": "foreign-scene", "changes": {"framing": "fit"}}]},
    ]:
        payload = {"project_id": p["id"], "base_revision": p["revision"], **fields}
        assert propose(client, url, p, json.dumps(payload)).status_code == 422
    assert client.get(url).json() == p


def test_caption_plan_changes_actual_timed_words_and_preserves_narration(client, image_bytes):
    from app.schemas import SceneInput

    url, p = episode(client, image_bytes)
    cues = [
        {"start": 0, "end": 2, "text": "Original subtitle."},
        {"start": 2, "end": 4, "text": "Second subtitle."},
    ]
    payload = {
        "base_revision": p["revision"],
        "title": p["title"],
        "settings": p["settings"],
        "cues": cues,
        "scenes": [
            {k: v for k, v in s.items() if k in SceneInput.model_fields} for s in p["scenes"]
        ],
    }
    response = client.put(url + "/workspace", json=payload)
    assert response.status_code == 200, response.text
    p = response.json()
    plan = {
        "project_id": p["id"],
        "base_revision": p["revision"],
        "caption_edits": [{"index": 0, "changes": {"text": "Corrected displayed words."}}],
    }
    response = propose(client, url, p, json.dumps(plan))
    assert response.status_code == 201, response.text
    row = response.json()
    candidate = client.get(url + f"/assistant/proposals/{row['id']}/preview").json()
    assert candidate["caption_cues"][0]["text"] == "Corrected displayed words."
    assert client.get(url).json()["caption_cues"] == cues
    applied = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": p["revision"]}
    ).json()
    assert applied["caption_cues"][0]["text"] == "Corrected displayed words."
    assert applied["narration_url"] == p["narration_url"]
    assert applied["scenes"] == p["scenes"]
    p = client.post(url + "/history/undo", json={"base_revision": applied["revision"]}).json()
    bad = {
        "project_id": p["id"],
        "base_revision": p["revision"],
        "caption_edits": [{"index": 1, "changes": {"start": 1}}],
    }
    assert propose(client, url, p, json.dumps(bad)).status_code == 422
    payload.update(base_revision=p["revision"])
    payload["scenes"][0]["locked"] = True
    p = client.put(url + "/workspace", json=payload).json()
    plan["base_revision"] = p["revision"]
    assert propose(client, url, p, json.dumps(plan)).status_code == 422
