from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Motion = Literal["hold", "zoom_in", "zoom_out", "pan_left", "pan_right"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class VideoSettings(StrictModel):
    fps: Literal[24, 30] = 24
    transition: Literal["cut", "fade"] = "fade"
    captions: bool = True
    default_duration: float = Field(default=5, ge=0.25, le=30)
    default_motion: Motion = "zoom_in"


class PanelMetadata(StrictModel):
    title: str = Field(default="", max_length=200)
    series: str = Field(default="", max_length=200)
    issue: str = Field(default="", max_length=50)
    page: int | None = Field(default=None, ge=1, le=10000)
    characters: str = Field(default="", max_length=500)
    fight: str = Field(default="", max_length=4000)


class Crop(StrictModel):
    x: float = Field(ge=0, lt=1)
    y: float = Field(ge=0, lt=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)
    output_width: int | None = Field(default=None, ge=16, le=4096)


class ProjectCreate(StrictModel):
    title: str = Field(min_length=1, max_length=200)
    idea: str = Field(default="", max_length=8000)
    template_id: str | None = None


class ProjectUpdate(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    idea: str | None = Field(default=None, max_length=8000)
    script: str | None = Field(default=None, max_length=20000)
    script_approved: bool | None = None
    settings: VideoSettings | None = None


class SceneInput(StrictModel):
    id: str | None = None
    panel_id: str
    duration: float = Field(default=5, ge=0.25, le=30)
    motion: Motion = "zoom_in"
    caption: str = Field(default="", max_length=300)


class SceneList(StrictModel):
    scenes: list[SceneInput] = Field(max_length=60)


class TemplateInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    settings: VideoSettings


class Login(StrictModel):
    token: str = Field(min_length=1, max_length=512)
