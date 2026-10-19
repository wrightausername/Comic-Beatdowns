import type { Easing, Motion, Transition } from "./effects";
export type { Easing, Motion, Transition } from "./effects";
export interface VideoSettings {
  fps: 24 | 30;
  transition: Transition;
  transition_duration: number;
  captions: boolean;
  default_duration: number;
  default_motion: Motion;
  default_motion_strength: number;
  default_easing: Easing;
  edit_pace: "fast" | "slow";
  narration_start: number;
  narration_end: number | null;
  normalize_voice: boolean;
  voice_volume: number;
  sfx_volume: number;
  music_volume: number;
  duck_audio: boolean;
  caption_font_size: number;
  caption_color: string;
  caption_accent: string;
  caption_style: "outline" | "box" | "punchy";
  caption_position: "bottom" | "middle" | "top";
  logo_position: "top_left" | "top_right" | "bottom_left" | "bottom_right";
  logo_width: number;
}
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}
export interface Waveform {
  duration: number;
  peaks: number[];
  pauses: [number, number][];
}
export interface Panel {
  id: string;
  title: string;
  series: string;
  issue: string;
  page: number | null;
  characters: string;
  fight: string;
  width: number;
  height: number;
  source_name: string;
  parent_id: string | null;
  created_at: string;
  image_url: string;
  thumbnail_url: string;
}
export interface Scene {
  id?: string;
  panel_id: string;
  position: number;
  duration: number;
  motion: Motion;
  motion_strength: number;
  easing: Easing;
  focus_x: number;
  focus_y: number;
  transition: Transition | null;
  transition_duration: number | null;
  caption: string;
  sfx_url: string | null;
  panel: Panel;
  locked?: boolean;
  note?: string;
  beat?: "custom" | "hit" | "reveal" | "reaction" | "read";
  sfx_id?: string | null;
  sfx_offset?: number;
  framing?: "fill" | "fit";
  sfx_source_id?: string | null;
  clear_sfx?: boolean;
}
export interface StoryCard {
  start: number;
  end: number;
  text: string;
  panel_id: string;
  beat?: Scene["beat"];
  reason?: string;
  estimated?: boolean;
}
export interface EditNote {
  id: string;
  time: number;
  text: string;
  done: boolean;
}
export interface Workflow {
  sound_choices?: Record<string, string>;
  panel_ids?: string[];
  storyboard?: StoryCard[];
  notes?: EditNote[];
}
export interface SoundEffect {
  id: string;
  name: string;
  kind: string;
  duration: number;
  url: string;
}
export type Status = "idea" | "scripting" | "ready" | "rendering" | "exported";
export interface Project {
  id: string;
  title: string;
  idea: string;
  status: Status;
  script: string;
  script_approved: boolean;
  settings: VideoSettings;
  narration_url: string | null;
  narration_duration: number | null;
  music_url: string | null;
  music_duration: number | null;
  logo_url: string | null;
  caption_cues: CaptionCue[];
  can_undo: boolean;
  can_redo: boolean;
  revision: number;
  created_at: string;
  updated_at: string;
  scene_count: number;
  duration: number;
  cover_url: string | null;
  scenes?: Scene[];
  workflow?: Workflow;
  watch_enabled?: boolean;
}
export interface RenderJob {
  id: string;
  project_id: string;
  project_revision: number;
  title: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  download_url: string | null;
  video_url: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  quality: "final" | "draft";
  section?: { start: number; end: number } | null;
}
export interface Template {
  id: string;
  name: string;
  settings: VideoSettings;
}
export interface Integrations {
  writing_enabled: boolean;
  voice_generation_enabled: boolean;
  publishing_enabled: boolean;
  comic_sources: unknown[];
  storage: string;
}
