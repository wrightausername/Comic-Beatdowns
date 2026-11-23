"""Reuse existing templates and approved Creative DNA rules for future episodes."""

import json

from sqlalchemy import select

from .database import CreativeRule, CreatorPreferences
from .schemas import VideoSettings

DEFAULT_FIELDS = {
    "edit_pace",
    "default_duration",
    "default_motion",
    "default_motion_strength",
    "default_easing",
    "transition",
    "transition_duration",
    "captions",
    "caption_position",
    "caption_font_size",
    "caption_style",
    "caption_color",
    "caption_accent",
    "voice_volume",
    "music_volume",
    "sfx_volume",
    "duck_audio",
}
RULE_PREFIX = "Preferred defaults: "


def preferences(db):
    value = db.get(CreatorPreferences, "owner")
    return {
        "template_id": value.template_id if value else None,
        "observe_edits": value.observe_edits if value else True,
        "updated_at": value.updated_at if value else None,
    }


def approved_defaults(db):
    result = {}
    for rule in db.scalars(
        select(CreativeRule)
        .where(CreativeRule.status == "approved", CreativeRule.scope.in_(("global", "short")))
        .order_by(CreativeRule.updated_at, CreativeRule.id)
    ):
        if not rule.instruction.startswith(RULE_PREFIX):
            continue
        try:
            values = json.loads(rule.instruction[len(RULE_PREFIX) :])
            if not isinstance(values, dict) or set(values) - DEFAULT_FIELDS:
                continue
            VideoSettings.model_validate({**VideoSettings().model_dump(), **values})
            result.update(values)
        except (ValueError, TypeError):
            continue
    return result
