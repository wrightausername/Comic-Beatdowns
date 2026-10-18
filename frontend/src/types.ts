export type Motion = "hold" | "zoom_in" | "zoom_out" | "pan_left" | "pan_right";
export interface VideoSettings {
  fps: 24 | 30;
  transition: "cut" | "fade";
  captions: boolean;
  default_duration: number;
  default_motion: Motion;
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
  caption: string;
  sfx_url: string | null;
  panel: Panel;
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
  revision: number;
  created_at: string;
  updated_at: string;
  scene_count: number;
  duration: number;
  cover_url: string | null;
  scenes?: Scene[];
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
