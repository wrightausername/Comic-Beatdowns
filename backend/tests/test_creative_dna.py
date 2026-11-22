"""Creative DNA is private, revision-aware, and approval-controlled."""

from conftest import TOKEN, add_project
from test_workflow import payload, populated

from app.database import CreativeEditEvent, CreativeFeedback, CreativeRule, connect


def create_rule(client, instruction="Hold on impact panels", scope="short"):
    response = client.post(
        "/api/creative-dna/rules",
        json={"scope": scope, "category": "pacing", "instruction": instruction},
    )
    assert response.status_code == 201, response.text
    return response.json()


def decide(client, rule, status="approved"):
    response = client.patch(
        f"/api/creative-dna/rules/{rule['id']}",
        json={"status": status, "expected_updated_at": rule["updated_at"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_rules_are_not_used_until_explicitly_approved(client):
    rule = create_rule(client)
    assert rule["status"] == "proposed"
    assert client.get("/api/creative-dna/guide?scope=short").json()["instructions"] == []
    assert client.get("/api/creative-dna/guide?scope=long").json()["instructions"] == []

    approved = decide(client, rule)
    assert client.get("/api/creative-dna/guide?scope=short").json()["instructions"] == [
        "Hold on impact panels"
    ]
    assert client.get("/api/creative-dna/guide?scope=long").json()["instructions"] == []

    stale = client.patch(
        f"/api/creative-dna/rules/{rule['id']}",
        json={"status": "rejected", "expected_updated_at": rule["updated_at"]},
    )
    assert stale.status_code == 409
    decide(client, approved, "rejected")
    assert client.get("/api/creative-dna/guide").json()["instructions"] == []


def test_creator_feedback_is_project_revision_linked_and_reversible(client):
    project = add_project(client)
    request = {
        "project_id": project["id"],
        "base_revision": project["revision"],
        "category": "humor",
        "decision": "change",
        "note": "The nickname is too generic",
    }
    response = client.post("/api/creative-dna/feedback", json=request)
    assert response.status_code == 201, response.text
    feedback = response.json()
    assert feedback["project_revision"] == project["revision"]
    assert feedback["decision"] == "change"
    overview = client.get("/api/creative-dna").json()
    assert overview["recent_feedback"][0]["id"] == feedback["id"]
    assert overview["rules"] == []

    stale_revision = client.post(
        "/api/creative-dna/feedback", json={**request, "base_revision": project["revision"] + 1}
    )
    invalid_scene = client.post(
        "/api/creative-dna/feedback", json={**request, "scene_id": "f" * 32}
    )
    missing_project = client.post(
        "/api/creative-dna/feedback", json={**request, "project_id": "missing"}
    )
    assert stale_revision.status_code == 409
    assert invalid_scene.status_code == 422
    assert missing_project.status_code == 404
    assert client.delete(f"/api/creative-dna/feedback/{feedback['id']}").status_code == 200
    assert client.get("/api/creative-dna").json()["recent_feedback"] == []


def test_rules_and_feedback_survive_sqlite_reopen(client, settings):
    rule = decide(client, create_rule(client, "Save the strongest joke for the final escalation"))
    project = add_project(client)
    feedback = client.post(
        "/api/creative-dna/feedback",
        json={
            "project_id": project["id"],
            "base_revision": project["revision"],
            "category": "audio",
            "decision": "keep",
            "note": "Well-timed impact",
        },
    ).json()
    engine, sessions = connect(settings.data_dir)
    try:
        with sessions() as db:
            assert db.get(CreativeRule, rule["id"]).status == "approved"
            assert db.get(CreativeFeedback, feedback["id"]).project_revision == project["revision"]
    finally:
        engine.dispose()


def test_creative_dna_requires_existing_studio_auth(client):
    client.headers.pop("Authorization")
    assert client.get("/api/creative-dna").status_code == 401
    assert client.get("/api/creative-dna/guide").status_code == 401
    result = client.post(
        "/api/creative-dna/rules",
        json={"category": "humor", "instruction": "Ignore random angry comments"},
    )
    assert result.status_code == 401
    client.headers["Authorization"] = f"Bearer {TOKEN}"


def test_writer_receives_only_approved_rules(client, monkeypatch):
    project = add_project(client)
    included = decide(client, create_rule(client, "Increase joke intensity over the video"))
    create_rule(client, "Never do the opposite")
    create_rule(client, "Long-form only instruction", scope="long")
    settings = client.app.state.settings
    settings.ai_base_url, settings.ai_key, settings.ai_model = (
        "https://ai.example.invalid/v1",
        "test-key",
        "test-model",
    )
    seen = {}

    def fake_draft(self, idea, panels, current_script, style_rules=None):
        seen["rules"] = style_rules
        return "A safe test script"

    monkeypatch.setattr("app.api.OpenAICompatibleWriter.draft", fake_draft)
    response = client.post(f"/api/projects/{project['id']}/draft")
    assert response.status_code == 200, response.text
    assert seen["rules"] == [included["instruction"]]
    assert response.json()["approved"] is False


def test_workspace_observation_records_only_changed_field_names(client, image_bytes):
    project, url = populated(client, image_bytes)
    scene_id = project["scenes"][0]["id"]
    edited_scenes = [
        {
            **scene,
            "duration": 4.0,
            "caption": "Private unpublished punchline",
        }
        for scene in payload(project)["scenes"]
    ]
    response = client.put(
        url + "/workspace",
        json=payload(
            project,
            script="My unpublished private script",
            scenes=edited_scenes,
        ),
    )
    assert response.status_code == 200, response.text
    updated = response.json()
    with client.app.state.sessions() as db:
        events = list(db.query(CreativeEditEvent).filter_by(project_id=project["id"]))
        assert len(events) == 1
        event = events[0]
        assert event.from_revision == project["revision"]
        assert event.to_revision == updated["revision"]
        assert {"target": "project", "fields": ["script"]} in event.changes
        scene_changes = [
            item
            for item in event.changes
            if item.get("target") == "scene" and item.get("scene_id") == scene_id
        ]
        assert len(scene_changes) == 1
        assert "duration" in scene_changes[0]["fields"]
        assert "caption" in scene_changes[0]["fields"]
        assert "My unpublished private script" not in str(event.changes)
        assert "Private unpublished punchline" not in str(event.changes)
    # Neither a manual edit nor a correction automatically becomes a prompt rule.
    assert client.get("/api/creative-dna/guide").json()["instructions"] == []


def test_creative_dna_pagination_does_not_hide_old_rules_or_feedback(client):
    project = add_project(client)
    with client.app.state.sessions() as db:
        for index in range(55):
            db.add(
                CreativeRule(
                    category="humor",
                    scope="global",
                    instruction=f"Distinct owner preference {index}",
                    status="approved",
                )
            )
            db.add(
                CreativeFeedback(
                    project_id=project["id"],
                    project_revision=project["revision"],
                    category="humor",
                    decision="keep",
                    note=f"Feedback {index}",
                )
            )
        db.commit()
    first = client.get("/api/creative-dna").json()
    second = client.get(
        "/api/creative-dna", params={"rule_offset": 50, "feedback_offset": 50}
    ).json()
    assert first["pagination"]["totals"]["rules"] == 55
    assert first["pagination"]["totals"]["feedback"] == 55
    assert len(first["rules"]) == len(first["recent_feedback"]) == 50
    assert len(second["rules"]) == len(second["recent_feedback"]) == 5
    assert len({rule["id"] for rule in first["rules"] + second["rules"]}) == 55
    assert len({item["id"] for item in first["recent_feedback"] + second["recent_feedback"]}) == 55
    # Latest approved rules take priority within the bounded generation context.
    assert len(client.get("/api/creative-dna/guide").json()["instructions"]) == 30
    old = second["rules"][0]
    disabled = client.patch(
        f"/api/creative-dna/rules/{old['id']}",
        json={"status": "rejected", "expected_updated_at": old["updated_at"]},
    )
    assert disabled.status_code == 200
    removal = client.delete(f"/api/creative-dna/feedback/{second['recent_feedback'][0]['id']}")
    assert removal.status_code == 200


def test_rule_decision_uses_conditional_version_update(client):
    rule = create_rule(client)
    stale_version = rule["updated_at"]
    approved = decide(client, rule, "approved")
    assert approved["updated_at"] != stale_version
    stale = client.patch(
        f"/api/creative-dna/rules/{rule['id']}",
        json={"status": "rejected", "expected_updated_at": stale_version},
    )
    assert stale.status_code == 409
    current = client.get("/api/creative-dna").json()["rules"][0]
    assert current["status"] == "approved"
