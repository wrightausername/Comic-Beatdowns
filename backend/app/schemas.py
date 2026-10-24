from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .effects import Easing, Motion, Transition


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class VideoSettings(StrictModel):
    fps: Literal[24, 30] = 24
    transition: Transition = "crossfade"
    transition_duration: float = Field(default=0.25, ge=0.08, le=0.8)
    captions: bool = True
    default_duration: float = Field(default=5, ge=0.25, le=30)
    default_motion: Motion = "zoom_in"
    default_motion_strength: float = Field(default=0.1, ge=0.02, le=0.3)
    default_easing: Easing = "smooth"
    edit_pace: Literal["fast", "slow"] = "fast"
    narration_start: float = Field(default=0, ge=0, le=179.75)
    narration_end: float | None = Field(default=None, gt=0, le=180)
    normalize_voice: bool = True
    voice_volume: float = Field(default=1, ge=0, le=2)
    sfx_volume: float = Field(default=0.35, ge=0, le=1)
    music_volume: float = Field(default=0.12, ge=0, le=1)
    duck_audio: bool = True
    caption_font_size: int = Field(default=62, ge=32, le=100)
    caption_color: str = Field(default="#FFFFFF", pattern=r"^#[0-9A-Fa-f]{6}$")
    caption_accent: str = Field(default="#00E5F5", pattern=r"^#[0-9A-Fa-f]{6}$")
    caption_style: Literal["outline", "box", "punchy"] = "outline"
    caption_position: Literal["bottom", "middle", "top"] = "bottom"
    logo_position: Literal["top_left", "top_right", "bottom_left", "bottom_right"] = "top_right"
    logo_width: int = Field(default=180, ge=80, le=360)

    @model_validator(mode="after")
    def valid_audio_range(self):
        if self.narration_end is not None and self.narration_end - self.narration_start < 0.25:
            raise ValueError("Select at least 0.25 seconds of narration")
        return self


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


class SmartCropSelection(StrictModel):
    indices: list[int] = Field(min_length=1, max_length=12)

    @field_validator("indices")
    @classmethod
    def validate_indices(cls, value):
        if any(index < 0 for index in value):
            raise ValueError("Panel indices must be nonnegative")
        return value


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
    motion_strength: float = Field(default=0.1, ge=0.02, le=0.3)
    easing: Easing = "smooth"
    focus_x: float = Field(default=0.5, ge=0, le=1)
    focus_y: float = Field(default=0.5, ge=0, le=1)
    transition: Transition | None = None
    transition_duration: float | None = Field(default=None, ge=0.08, le=0.8)
    caption: str = Field(default="", max_length=300)
    locked: bool = False
    note: str = Field(default="", max_length=2000)
    beat: Literal["custom", "hit", "reveal", "reaction", "read"] = "custom"
    sfx_id: str | None = None
    sfx_offset: float = Field(default=0, ge=0, le=30)
    framing: Literal["fill", "fit"] = "fill"
    sfx_source_id: str | None = None
    clear_sfx: bool = False


class SceneList(StrictModel):
    scenes: list[SceneInput] = Field(max_length=240)


class CaptionCue(StrictModel):
    start: float = Field(ge=0, le=180)
    end: float = Field(gt=0, le=180)
    text: str = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def valid_interval(self):
        if self.end <= self.start or not self.text.strip():
            raise ValueError("Captions need text and an end after their start")
        return self


class CaptionList(StrictModel):
    cues: list[CaptionCue] = Field(default_factory=list, max_length=600)

    @model_validator(mode="after")
    def ordered_captions(self):
        if any(a.end > b.start + 0.001 for a, b in zip(self.cues, self.cues[1:])):
            raise ValueError("Caption times must be ordered without overlaps")
        return self


class CaptionGenerateInput(StrictModel):
    use_script: bool = False


class WorkspaceInput(CaptionList):
    base_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=200)
    idea: str = Field(default="", max_length=8000)
    script: str = Field(default="", max_length=20000)
    settings: VideoSettings
    scenes: list[SceneInput] = Field(max_length=240)
    workflow: dict = Field(default_factory=dict)


class RevisionInput(StrictModel):
    base_revision: int = Field(ge=1)


class AutoEditInput(StrictModel):
    pace: Literal["fast", "slow"] = "fast"
    length: Literal["full", "short"] = "full"
    shot_seconds: float | None = Field(default=None, ge=0.5, le=10)


class RenderInput(StrictModel):
    quality: Literal["final", "draft"] = "final"
    start: float | None = Field(default=None, ge=0, lt=180)
    end: float | None = Field(default=None, gt=0, le=180)

    @model_validator(mode="after")
    def section_range(self):
        if (self.start is None) != (self.end is None):
            raise ValueError("Select both ends of a preview section")
        if self.start is not None and (self.end - self.start < 0.25 or self.quality != "draft"):
            raise ValueError("Section previews must be drafts of at least 0.25 seconds")
        return self


class BuildDraftInput(StrictModel):
    pace: Literal["fast", "slow"] = "fast"
    match_panels: bool = True
    camera_moves: bool = True
    sound_effects: bool = True
    captions: bool = False


class AudioPrepareInput(StrictModel):
    reduce_noise: bool = True
    shorten_pauses: bool = False


class VersionInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)


class BatchRenderInput(StrictModel):
    project_ids: list[str] = Field(min_length=1, max_length=20)


class WatchInput(StrictModel):
    enabled: bool


class AutopilotOptions(StrictModel):
    enabled: bool = False
    mode: Literal["basic", "vision"] = "basic"
    pace: Literal["fast", "slow"] = "fast"
    delivery: Literal["draft", "final"] = "draft"


class DirectorStart(StrictModel):
    base_revision: int = Field(ge=1)


class VisionConnection(StrictModel):
    base_url: str = Field(min_length=1, max_length=300)
    model: str = Field(min_length=1, max_length=120)
    api_key: str | None = Field(default=None, max_length=512)
    transcription_model: str = Field(default="", max_length=120)


class TemplateInput(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    settings: VideoSettings
    project_id: str | None = None


class Login(StrictModel):
    token: str = Field(min_length=1, max_length=512)


class AutopilotUpdate(AutopilotOptions):
    base_revision: int = Field(ge=1)
