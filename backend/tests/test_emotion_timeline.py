import pytest
from fastapi import HTTPException

from app.automation import validate_workflow


def test_workflow_keeps_emotion_timing_overrides():
    value = {"emotion_overrides": {"12:0:deadpan": 3.5, "55:1:pause": 6.25}}
    assert validate_workflow(value, None) == value


@pytest.mark.parametrize(
    "bad",
    [
        {"wrong": 1.0},
        {"1:0:shouting": -2.0},
        {"1:0:shouting": 181.0},
        {"1:0:shouting": float("nan")},
        {"1:0:shouting": True},
    ],
)
def test_workflow_rejects_invalid_emotion_timing(bad):
    with pytest.raises(HTTPException) as error:
        validate_workflow({"emotion_overrides": bad}, None)
    assert error.value.status_code == 422
