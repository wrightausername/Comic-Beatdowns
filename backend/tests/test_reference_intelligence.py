import json
import math
import subprocess
import time
import wave
from array import array
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from conftest import add_panel
from test_reference_style import episode, import_style, propose, tweak
from test_reference_style import reference_clip as reference_clip

from app.database import EditProposal, RenderJob
from app.reference_analysis import representative_indices
from app.reference_planner import narration_anchors, snapped_lengths
from app.schemas import VisionConnection
from app.verdict_provider import save_connection


def preview(client, url, row):
    response = client.get(url + f"/assistant/proposals/{row['id']}/preview")
    assert response.status_code == 200, response.text
    return response.json()


def save_recipe(client, style, beats, **kwargs):
    recipe = {"beats": beats, "transition_duration": 0.15, "motion_strength": 0.2, **kwargs}
    result = client.put(
        f"/api/reference-styles/{style['id']}",
        json={"base_revision": style["revision"], "name": style["name"], "recipe": recipe},
    )
    assert result.status_code == 200, result.text
    return result.json()


def test_structure_preserves_early_slow_late_fast_rhythm_and_per_beat_controls(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [
            {
                "seconds": 2,
                "transition": "crossfade",
                "motion": "zoom_in",
                "motion_strength": 0.08,
                "transition_duration": 0.4,
                "easing": "linear",
            },
            {"seconds": 0.5, "transition": "cut", "motion": "punch_in", "easing": "ease_out"},
            {
                "seconds": 0.5,
                "transition": "slide_left",
                "motion": "punch_out",
                "easing": "ease_out",
            },
        ],
    )
    row = propose(client, url, project, style, mapping="structure", tempo=2).json()
    candidate = preview(client, url, row)
    durations = [s["duration"] for s in candidate["scenes"]]
    assert sum(durations[: len(durations) // 2]) > sum(durations[len(durations) // 2 :])
    assert candidate["scenes"][0]["motion"] == "zoom_in"
    assert candidate["scenes"][0]["transition_duration"] == 0.4
    assert candidate["scenes"][0]["motion_strength"] == 0.08
    assert candidate["scenes"][0]["easing"] == "linear"
    assert any(s["motion"] in {"punch_in", "punch_out"} for s in candidate["scenes"][-3:])
    assert "opening" in row["report"]["summary"][0]
    trace = row["report"]["trace"]
    assert trace[0]["reference_beat"] == 1
    assert trace[-1]["reference_beat"] == 3
    assert all(item["reason"].startswith("Matched reference position") for item in trace)
    assert all(1 <= item["source_shot"] <= len(project["scenes"]) for item in trace)
    assert client.get(url).json() == project


def test_slow_style_consolidates_only_repeated_artwork_and_can_undo(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [{"seconds": 10, "motion": "zoom_in", "transition": "crossfade"}],
    )
    row = propose(client, url, project, style, mapping="structure").json()
    candidate = preview(client, url, row)
    assert len(candidate["scenes"]) == 1
    assert candidate["scenes"][0]["duration"] == 6
    assert candidate["scenes"][0]["panel_id"] == project["scenes"][0]["panel_id"]
    assert row["report"]["counts"]["consolidated_shots"] == 2
    saved = client.post(
        url + f"/assistant/proposals/{row['id']}/apply", json={"base_revision": project["revision"]}
    ).json()
    undone = client.post(url + "/history/undo", json={"base_revision": saved["revision"]}).json()
    assert undone["scenes"] == project["scenes"]


def test_narration_alignment_is_frozen_explainable_and_does_not_move_voice_or_subtitles(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    client.post(
        url + "/import-file",
        files={
            "file": (
                "words.srt",
                b"1\n00:00:00,000 --> 00:00:03,125\nA finished phrase.\n",
                "text/plain",
            )
        },
        data={"kind": "captions"},
    )
    project = client.get(url).json()
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style, align_narration=True).json()
    assert 75 in row["plan"]["alignment"]["frames"]
    candidate = preview(client, url, row)
    assert row["report"]["counts"]["aligned_cuts"] >= 1
    boundaries, cursor = [], 0
    for shot in candidate["scenes"]:
        cursor += round(shot["duration"] * 24)
        boundaries.append(cursor)
    assert 75 in boundaries and cursor == 144
    assert (
        candidate["caption_cues"] == project["caption_cues"]
        and candidate["narration_url"] == project["narration_url"]
    )
    assert candidate == preview(client, url, row)
    assert snapped_lengths([30, 30, 30], 12, 100, [(33, 5), (60, 5)]) == ([33, 27, 30], 1)


def test_effect_guards_skip_unreviewed_flashes_and_limit_density(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [
            {
                "seconds": 0.5,
                "transition": "dip_white",
                "motion": "impact_shake",
                "motion_reviewed": False,
                "transition_reviewed": False,
            }
        ],
    )
    row = propose(
        client,
        url,
        project,
        style,
        use_suggestions=False,
        allow_flashes=False,
        effects_per_minute=0,
    ).json()
    candidate = preview(client, url, row)
    assert all(s["motion"] == "hold" and s["motion_strength"] == 0.1 for s in candidate["scenes"])
    assert all(s["transition"] != "dip_white" for s in candidate["scenes"])
    assert row["report"]["counts"]["unreviewed_effects_skipped"] > 0
    row = propose(
        client, url, project, style, effects_per_minute=20, use_suggestions=True, allow_flashes=True
    ).json()
    candidate = preview(client, url, row)
    heavy = [
        i
        for i, s in enumerate(candidate["scenes"])
        if s["motion"] == "impact_shake" or s["transition"] == "dip_white"
    ]
    assert len(heavy) <= 2
    assert row["report"]["counts"]["budgeted_effects_skipped"] > 0
    assert client.get(url).json() == project


def test_purpose_mapping_and_reading_holds_protect_story_content(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    scenes = [
        {
            "id": s["id"],
            "panel_id": s["panel_id"],
            "duration": s["duration"],
            "motion": "hold",
            "beat": "read" if i == 0 else "hit" if i == 2 else "custom",
        }
        for i, s in enumerate(project["scenes"])
    ]
    client.put(url + "/scenes", json={"scenes": scenes})
    project = client.get(url).json()
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [
            {"seconds": 1, "transition": "slide_left", "motion": "impact_shake", "purpose": "hit"},
            {"seconds": 1, "transition": "cut", "motion": "hold", "purpose": "read"},
        ],
    )
    row = propose(client, url, project, style, mapping="structure").json()
    candidate = preview(client, url, row)
    assert candidate["scenes"][0]["duration"] == 2 and candidate["scenes"][0]["motion"] == "hold"
    assert row["report"]["counts"]["purpose_matches"] > 0
    assert any(s["beat"] == "hit" and s["motion"] == "impact_shake" for s in candidate["scenes"])


def test_recipe_copies_excerpts_backup_and_versions_are_recoverable(client, reference_clip):
    style = import_style(client, reference_clip)
    response = client.post(
        f"/api/reference-styles/{style['id']}/copy",
        json={
            "base_revision": style["revision"],
            "name": "My independent copy",
            "recipe": style["recipe"],
        },
    )
    assert response.status_code == 201
    copy = response.json()
    excerpt = client.post(
        f"/api/reference-styles/{style['id']}/excerpt",
        json={"base_revision": style["revision"], "start": 0.5, "end": 2.5},
    )
    assert excerpt.status_code == 201, excerpt.text
    assert excerpt.json()["analysis"]["start"] == 0.5
    client.request(
        "DELETE", f"/api/reference-styles/{style['id']}", json={"base_revision": style["revision"]}
    )
    assert client.get(copy["video_url"]).status_code == 200
    original_recipe = copy["recipe"]
    copy = tweak(client, copy)
    versions = client.get(f"/api/reference-styles/{copy['id']}/versions").json()
    assert versions[0]["revision"] == 1
    restored = client.post(
        f"/api/reference-styles/{copy['id']}/versions/1/restore",
        json={"base_revision": copy["revision"]},
    )
    assert restored.status_code == 200 and restored.json()["recipe"] == original_recipe
    backup = client.get(f"/api/reference-styles/{copy['id']}/recipe")
    assert "attachment" in backup.headers["content-disposition"]
    assert "storage_key" not in backup.text and "api_key" not in backup.text
    imported = client.post(
        "/api/reference-styles/import-recipe",
        files={"file": ("style.json", backup.content, "application/json")},
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["video_url"] is None
    assert imported.json()["recipe"] == original_recipe
    invalid = backup.json()
    invalid["execute"] = "run a program"
    assert (
        client.post(
            "/api/reference-styles/import-recipe",
            files={"file": ("style.json", json.dumps(invalid))},
        ).status_code
        == 422
    )


def configure_vision(settings):
    save_connection(
        settings,
        VisionConnection(
            base_url="https://vision.example/v1", model="test-vision", api_key="fixture-private-key"
        ),
    )


def vision_response(index=0, **extra):
    return Mock(
        raise_for_status=lambda: None,
        json=lambda: {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "summary": "Slow reveal, then an impact.",
                                "observations": [
                                    {
                                        "index": index,
                                        "purpose": "hit",
                                        "motion": "impact_shake",
                                        "transition": "cut",
                                        "evidence": "A sampled impact frame follows the close-up.",
                                        "confidence": "uncertain",
                                        **extra,
                                    }
                                ],
                                "unsupported_effects": [
                                    "Masked character isolation requires manual work."
                                ],
                            }
                        )
                    }
                }
            ]
        },
    )


def test_vision_requires_per_request_consent_and_sends_only_reference_frames(
    client, reference_clip, settings, monkeypatch
):
    style = import_style(client, reference_clip)
    configure_vision(settings)
    calls = []

    def post(*args, **kwargs):
        calls.append(kwargs)
        return vision_response()

    monkeypatch.setattr("app.reference_vision.httpx.post", post)
    url = f"/api/reference-styles/{style['id']}/understand"
    for body in [
        {"base_revision": style["revision"]},
        {"base_revision": style["revision"], "share_frames": False},
    ]:
        assert client.post(url, json=body).status_code == 422
    assert not calls
    response = client.post(url, json={"base_revision": style["revision"], "share_frames": True})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["recipe"]["beats"][0]["motion"] == "impact_shake"
    assert not result["recipe"]["beats"][0]["motion_reviewed"]
    body = json.dumps(calls[0]["json"])
    assert (
        "fixture-private-key" not in body and "narration_key" not in body and "panel_id" not in body
    )
    assert "data:image/jpeg;base64," in body and len(result["shared_frames"]) <= 18
    assert calls[0]["follow_redirects"] is False
    assert (
        next(s for s in client.get("/api/reference-styles").json() if s["id"] == style["id"])[
            "recipe"
        ]
        == style["recipe"]
    )


def test_vision_rejects_foreign_indices_code_and_route_commands(
    client, reference_clip, settings, monkeypatch
):
    style = import_style(client, reference_clip)
    configure_vision(settings)
    for response in [
        vision_response(index=239),
        vision_response(motion="panel_glide"),
        vision_response(execute="bad command"),
    ]:
        monkeypatch.setattr("app.reference_vision.httpx.post", lambda *args, **kwargs: response)
        result = client.post(
            f"/api/reference-styles/{style['id']}/understand",
            json={"base_revision": style["revision"], "share_frames": True},
        )
        assert result.status_code == 422
    assert (
        next(s for s in client.get("/api/reference-styles").json() if s["id"] == style["id"])[
            "revision"
        ]
        == style["revision"]
    )


def test_old_pending_style_proposals_keep_their_original_algorithm(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style).json()
    with client.app.state.sessions() as db:
        stored = db.get(EditProposal, row["id"])
        stored.plan = {k: v for k, v in stored.plan.items() if k not in {"algorithm", "alignment"}}
        db.commit()
    candidate = preview(client, url, row)
    assert any(s["transition"] == "dip_white" for s in candidate["scenes"])


@pytest.mark.render
def test_rendered_proposal_is_immutable_and_not_a_saved_episode_review(
    client, image_bytes, reference_clip, settings
):
    url, project = episode(client, image_bytes)
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style).json()
    response = client.post(
        url + f"/assistant/proposals/{row['id']}/render",
        json={"base_revision": project["revision"]},
    )
    assert response.status_code == 202, response.text
    job = response.json()
    assert job["proposal_id"] == row["id"] and job["quality"] == "draft"
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        job = client.get(f"/api/renders/{job['id']}").json()
        if job["status"] in {"completed", "failed"}:
            break
        time.sleep(0.1)
    assert job["status"] == "completed", job
    assert client.get(url).json() == project
    check = client.get(url + "/finish-check").json()
    assert check["scanned_render_id"] is None
    assert any(f["code"] == "full_review_needed" for f in check["findings"])
    with client.app.state.sessions() as db:
        render = db.get(RenderJob, job["id"])
        assert render.snapshot["proposal_id"] == row["id"]
        assert "references/" not in json.dumps(render.snapshot)
        output = client.app.state.storage.path(render.output_key)
    result = subprocess.run(
        [settings.ffprobe, "-v", "error", "-show_streams", "-of", "json", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    video = next(s for s in json.loads(result.stdout)["streams"] if s["codec_type"] == "video")
    assert (video["width"], video["height"], int(video["nb_frames"])) == (360, 640, 144)


def test_reference_audio_accents_are_measured_without_copying_audio(
    client, reference_clip, settings, tmp_path
):
    video = tmp_path / "reference.mp4"
    video.write_bytes(reference_clip)
    sound = tmp_path / "accents.wav"
    samples = array(
        "h",
        (
            int(18000 * math.sin(2 * math.pi * 440 * i / 16000))
            if 0.4 <= i / 16000 <= 0.48 or 1.2 <= i / 16000 <= 1.28
            else 0
            for i in range(32000)
        ),
    )
    with wave.open(str(sound), "wb") as stream:
        stream.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        stream.writeframes(samples.tobytes())
    output = tmp_path / "with-audio.mp4"
    subprocess.run(
        [
            settings.ffmpeg,
            "-v",
            "error",
            "-i",
            str(video),
            "-i",
            str(sound),
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            "-y",
            str(output),
        ],
        check=True,
        capture_output=True,
        timeout=30,
    )
    style = import_style(client, output.read_bytes())
    assert style["analysis"]["audio"]["available"]
    assert style["analysis"]["audio"]["accents"]
    assert all(0 <= t <= style["analysis"]["end"] for t in style["analysis"]["audio"]["accents"])
    assert "not copied" in style["analysis"]["audio"]["reason"]


def test_low_intensity_reduces_new_effect_strength_and_noop_transfers_are_declined(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [
            {
                "seconds": 1,
                "motion": "impact_shake",
                "motion_strength": 0.2,
                "transition": "crossfade",
                "transition_duration": 0.4,
            }
        ],
    )
    low = preview(
        client, url, propose(client, url, project, style, pacing=False, intensity=0.1).json()
    )
    high = preview(
        client, url, propose(client, url, project, style, pacing=False, intensity=1).json()
    )
    assert 0.02 <= low["scenes"][0]["motion_strength"] < high["scenes"][0]["motion_strength"]
    assert low["scenes"][0]["transition_duration"] < high["scenes"][0]["transition_duration"]
    client.put(
        url + "/scenes",
        json={
            "scenes": [
                {
                    "panel_id": s["panel_id"],
                    "duration": s["duration"],
                    "motion": "hold",
                    "transition": "cut",
                }
                for s in project["scenes"]
            ]
        },
    )
    project = client.get(url).json()
    style = save_recipe(client, style, [{"seconds": 1, "motion": "hold", "transition": "cut"}])
    assert propose(client, url, project, style, pacing=False, camera=False).status_code == 422


def test_minimum_holds_explain_constraints_without_dropping_distinct_sources(
    client, image_bytes, reference_clip
):
    url, project = episode(client, image_bytes)
    panels = [add_panel(client, image_bytes, f"Distinct panel {i}") for i in range(4)]
    client.put(
        url + "/scenes", json={"scenes": [{"panel_id": p["id"], "duration": 0.25} for p in panels]}
    )
    project = client.get(url).json()
    style = tweak(client, import_style(client, reference_clip))
    row = propose(client, url, project, style, minimum_hold=0.5).json()
    candidate = preview(client, url, row)
    assert [s["panel_id"] for s in candidate["scenes"]] == [p["id"] for p in panels]
    assert any("minimum hold" in text for text in row["report"]["warnings"])
    assert sum(round(s["duration"] * 24) for s in candidate["scenes"]) == 24


def test_recipe_history_is_bounded_and_concurrent_vision_review_fails_stale(
    client, reference_clip, settings, monkeypatch
):
    style = import_style(client, reference_clip)
    for _ in range(23):
        style = tweak(client, style)
    assert len(client.get(f"/api/reference-styles/{style['id']}/versions").json()) == 20
    configure_vision(settings)

    def edit_during_review(*args, **kwargs):
        assert (
            client.request(
                "DELETE",
                f"/api/reference-styles/{style['id']}",
                json={"base_revision": style["revision"]},
            ).status_code
            == 409
        )
        tweak(client, style)
        return vision_response()

    monkeypatch.setattr("app.reference_vision.httpx.post", edit_during_review)
    response = client.post(
        f"/api/reference-styles/{style['id']}/understand",
        json={"base_revision": style["revision"], "share_frames": True},
    )
    assert response.status_code == 409
    current = next(s for s in client.get("/api/reference-styles").json() if s["id"] == style["id"])
    assert current["revision"] == style["revision"] + 1
    assert not client.app.state.reference_lock.locked()


def test_dense_reference_summaries_keep_the_ending_and_important_holds():
    beats = [{"seconds": 0.3, "transition": "cut"} for _ in range(500)]
    beats[213] = {"seconds": 10, "transition": "fade"}
    beats[-1] = {"seconds": 3, "transition": "crossfade"}
    indices = representative_indices(beats)
    assert len(indices) == 240 and indices == sorted(set(indices))
    assert {0, 213, 499} <= set(indices)
    assert len(representative_indices(beats, limit=5)) == 5


def test_alignment_ignores_narration_outside_the_selected_excerpt():
    project = SimpleNamespace(
        settings={"fps": 24, "narration_start": 1, "narration_end": 3},
        narration_duration=6,
        narration_key=None,
        caption_cues=[
            {"start": 0.2, "end": 0.8},
            {"start": 1.2, "end": 2.4},
            {"start": 3.4, "end": 5},
        ],
    )
    anchors = narration_anchors(project, SimpleNamespace())
    assert anchors["frames"] == [5, 34]


def test_large_unicode_recipe_backup_round_trips_without_source_files(client, reference_clip):
    style = save_recipe(
        client,
        import_style(client, reference_clip),
        [
            {"seconds": 0.25, "transition": "cut", "motion": "hold", "evidence": "🎬" * 600}
            for _ in range(240)
        ],
    )
    backup = client.get(f"/api/reference-styles/{style['id']}/recipe")
    assert len(backup.content) > 256 * 1024
    imported = client.post(
        "/api/reference-styles/import-recipe",
        files={"file": ("style.json", backup.content, "application/json")},
    )
    assert imported.status_code == 201, imported.text
    assert imported.json()["recipe"] == style["recipe"] and imported.json()["video_url"] is None
