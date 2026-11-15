"""Creative DNA is private, revision-aware, and approval-controlled."""

from conftest import TOKEN, add_project

from app.database import CreativeFeedback, CreativeRule, connect


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

    assert client.post(
        "/api/creative-dna/feedback", json={**request, "base_revision": project["revision"] + 1}
    ).status_code == 409
    assert client.post(
        "/api/creative-dna/feedback", json={**request, "scene_id": "f" * 32}
    ).status_code == 422
    assert client.post(
        "/api/creative-dna/feedback", json={**request, "project_id": "missing"}
    ).status_code == 404
    assert client.delete(f"/api/creative-dna/feedback/{feedback['id']}").status_code == 204
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
    assert client.post(
        "/api/creative-dna/rules",
        json={"category": "humor", "instruction": "Ignore random angry comments"},
    ).status_code == 401
    client.headers["Authorization"] = f"Bearer {TOKEN}"


def test_writer_receives_only_approved_rules(client, monkeypatch):
    project = add_project(client)
    included = decide(client, create_rule(client, "Increase joke intensity over the video"))
    create_rule(client, "Never do the opposite")
    create_rule(client, "Long-form only instruction", scope="long")
    settings = client.app.state.settings
    settings.ai_base_url, settings.ai_key, settings.ai_model = (
        "https://ai.example.invalid/v1", "test-key", "test-model"
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
