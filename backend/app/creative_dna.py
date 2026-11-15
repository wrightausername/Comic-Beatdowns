"""Private, versioned Creative DNA foundation.

The owner must explicitly approve reusable rules. Individual corrections and
audience reactions are *evidence*, never silent global prompt instructions.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .database import CreativeEditEvent, CreativeFeedback, CreativeRule, Project, Scene, now
from .schemas import StrictModel

router = APIRouter(prefix="/api/creative-dna", tags=["Creative DNA"])

Scope = Literal["global", "short", "long"]
Category = Literal[
    "humor", "voice", "story", "pacing", "panel", "crop", "captions", "audio", "other"
]
Status = Literal["proposed", "approved", "rejected"]


def session(request: Request):
    with request.app.state.sessions() as db:
        yield db


class RuleCreate(StrictModel):
    scope: Scope = "global"
    category: Category
    instruction: str = Field(min_length=3, max_length=500)


class RuleDecision(StrictModel):
    status: Status
    expected_updated_at: str


class FeedbackCreate(StrictModel):
    project_id: str = Field(min_length=1, max_length=64)
    base_revision: int = Field(ge=1)
    scene_id: str | None = Field(default=None, max_length=64)
    category: Category
    decision: Literal["keep", "change", "one_off"]
    note: str = Field(default="", max_length=1000)


def rule_dict(rule: CreativeRule) -> dict:
    return {
        "id": rule.id,
        "scope": rule.scope,
        "category": rule.category,
        "instruction": rule.instruction,
        "source": rule.source,
        "status": rule.status,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def edit_dict(edit: CreativeEditEvent) -> dict:
    return {
        "id": edit.id,
        "project_id": edit.project_id,
        "from_revision": edit.from_revision,
        "to_revision": edit.to_revision,
        "changes": edit.changes,
        "created_at": edit.created_at,
    }


def feedback_dict(feedback: CreativeFeedback) -> dict:
    return {
        "id": feedback.id,
        "project_id": feedback.project_id,
        "project_revision": feedback.project_revision,
        "scene_id": feedback.scene_id,
        "category": feedback.category,
        "decision": feedback.decision,
        "note": feedback.note,
        "created_at": feedback.created_at,
    }


def approved_instructions(db: Session, scope: str) -> list[str]:
    """Only owner-approved rules can enter generation prompts."""
    if scope not in {"short", "long"}:
        raise ValueError("Unknown video format")
    rows = db.scalars(
        select(CreativeRule)
        .where(
            CreativeRule.status == "approved",
            CreativeRule.scope.in_(("global", scope)),
        )
        .order_by(CreativeRule.updated_at.desc(), CreativeRule.id.desc())
        .limit(30)
    )
    return [rule.instruction for rule in rows]


@router.get("")
def overview(
    rule_offset: int = Query(default=0, ge=0),
    feedback_offset: int = Query(default=0, ge=0),
    edit_offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(session),
):
    rules = list(
        db.scalars(
            select(CreativeRule)
            .order_by(CreativeRule.created_at.desc(), CreativeRule.id.desc())
            .offset(rule_offset)
            .limit(limit)
        )
    )
    feedback = list(
        db.scalars(
            select(CreativeFeedback)
            .order_by(CreativeFeedback.created_at.desc(), CreativeFeedback.id.desc())
            .offset(feedback_offset)
            .limit(limit)
        )
    )
    edits = list(
        db.scalars(
            select(CreativeEditEvent)
            .order_by(CreativeEditEvent.created_at.desc(), CreativeEditEvent.id.desc())
            .offset(edit_offset)
            .limit(limit)
        )
    )
    totals = {
        "rules": db.scalar(select(func.count()).select_from(CreativeRule)) or 0,
        "feedback": db.scalar(select(func.count()).select_from(CreativeFeedback)) or 0,
        "edits": db.scalar(select(func.count()).select_from(CreativeEditEvent)) or 0,
    }
    return {
        "rules": [rule_dict(r) for r in rules],
        "recent_feedback": [feedback_dict(f) for f in feedback],
        "observed_edits": [edit_dict(e) for e in edits],
        "pagination": {
            "limit": limit,
            "rule_offset": rule_offset,
            "feedback_offset": feedback_offset,
            "edit_offset": edit_offset,
            "totals": totals,
        },
    }


@router.get("/guide")
def generation_guide(scope: Literal["short", "long"] = "short", db: Session = Depends(session)):
    return {"scope": scope, "instructions": approved_instructions(db, scope)}


@router.post("/rules", status_code=201)
def create_rule(data: RuleCreate, db: Session = Depends(session)):
    rule = CreativeRule(**data.model_dump(), source="creator", status="proposed")
    db.add(rule)
    db.commit()
    return rule_dict(rule)


@router.patch("/rules/{rule_id}")
def decide_rule(rule_id: str, data: RuleDecision, db: Session = Depends(session)):
    result = db.execute(
        update(CreativeRule)
        .where(
            CreativeRule.id == rule_id,
            CreativeRule.updated_at == data.expected_updated_at,
        )
        .values(status=data.status, updated_at=now())
    )
    if result.rowcount != 1:
        db.rollback()
        if db.get(CreativeRule, rule_id) is None:
            raise HTTPException(404, "Creative rule not found")
        raise HTTPException(409, "The rule changed in another window. Reload before changing it.")
    db.commit()
    return rule_dict(db.get(CreativeRule, rule_id))


@router.post("/feedback", status_code=201)
def record_feedback(data: FeedbackCreate, db: Session = Depends(session)):
    project = db.get(Project, data.project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    if project.revision != data.base_revision:
        raise HTTPException(409, "This episode changed. Refresh before recording feedback.")
    if data.scene_id:
        scene = db.get(Scene, data.scene_id)
        if scene is None or scene.project_id != project.id:
            raise HTTPException(422, "That scene does not belong to this episode")
    feedback = CreativeFeedback(
        project_id=project.id,
        project_revision=project.revision,
        scene_id=data.scene_id,
        category=data.category,
        decision=data.decision,
        note=data.note.strip(),
    )
    db.add(feedback)
    db.commit()
    return feedback_dict(feedback)


@router.delete("/feedback/{feedback_id}")
def delete_feedback(feedback_id: str, db: Session = Depends(session)):
    feedback = db.get(CreativeFeedback, feedback_id)
    if feedback is None:
        raise HTTPException(404, "Feedback not found")
    db.delete(feedback)
    db.commit()
    return {"removed": True}
