import type { Panel, Project, Scene, StoryCard, VideoSettings } from "./types";
import { timelineSeconds } from "./utils";

export const newId = () => crypto.randomUUID().replaceAll("-", "");
export const makeScene = (panel: Panel, settings: VideoSettings): Scene => ({
  id: newId(),
  panel_id: panel.id,
  panel,
  position: 0,
  duration: settings.default_duration,
  motion: settings.default_motion,
  motion_strength: settings.default_motion_strength,
  easing: settings.default_easing,
  focus_x: 0.5,
  focus_y: 0.5,
  transition: null,
  transition_duration: null,
  caption: "",
  sfx_url: null,
  sfx_id: null,
  sfx_offset: 0,
  locked: false,
  note: "",
  beat: "custom",
});
export const beatPresets: Record<string, Partial<Scene>> = {
  hit: {
    motion: "punch_in",
    motion_strength: 0.26,
    easing: "ease_out",
    transition: "cut",
    beat: "hit",
  },
  reveal: {
    motion: "zoom_out",
    motion_strength: 0.22,
    easing: "ease_out",
    transition: "cut",
    beat: "reveal",
  },
  reaction: {
    motion: "punch_out",
    motion_strength: 0.2,
    easing: "ease_out",
    transition: "cut",
    beat: "reaction",
  },
  read: {
    motion: "hold",
    motion_strength: 0.02,
    easing: "linear",
    transition: "cut",
    beat: "read",
  },
};
export function splitScene(
  scenes: Scene[],
  index: number,
  fps: number,
  at?: number,
): Scene[] {
  const source = scenes[index],
    frames = Math.round(source.duration * fps),
    minimum = Math.ceil(0.25 * fps);
  if (source.locked || frames < minimum * 2) return scenes;
  const left = Math.max(
    minimum,
    Math.min(frames - minimum, Math.round((at ?? source.duration / 2) * fps)),
  );
  const offset = source.sfx_offset ?? 0;
  const first = {
    ...source,
    duration: left / fps,
    ...(offset >= left / fps
      ? { sfx_id: null, sfx_url: null, clear_sfx: true }
      : {}),
  };
  const second = {
    ...source,
    id: newId(),
    sfx_source_id:
      offset >= left / fps ? (source.sfx_source_id ?? source.id) : null,
    clear_sfx: offset < left / fps,
    duration: (frames - left) / fps,
    caption: "",
    note: "",
    transition: "cut" as const,
    sfx_id: offset >= left / fps ? source.sfx_id : null,
    sfx_url: offset >= left / fps ? source.sfx_url : null,
    sfx_offset: offset >= left / fps ? offset - left / fps : 0,
  };
  return [...scenes.slice(0, index), first, second, ...scenes.slice(index + 1)];
}
export function fitScenes(
  scenes: Scene[],
  seconds: number,
  fps: number,
): Scene[] {
  const fixed = scenes
    .filter((s) => s.locked)
    .reduce((sum, s) => sum + Math.round(s.duration * fps), 0);
  const open = scenes.filter((s) => !s.locked),
    remaining = Math.ceil(seconds * fps - 1e-6) - fixed;
  if (
    (!open.length && remaining !== 0) ||
    remaining < open.length * Math.ceil(0.25 * fps) ||
    remaining > open.length * 30 * fps
  )
    throw new Error(
      "Unlock a scene, or add/remove shots so the selected narration fits.",
    );
  let index = 0;
  return scenes.map((s) =>
    s.locked
      ? s
      : {
          ...s,
          duration:
            (Math.floor(remaining / open.length) +
              (index++ < remaining % open.length ? 1 : 0)) /
            fps,
        },
  );
}
export function applyStoryboard(
  scenes: Scene[],
  cards: StoryCard[],
  start: number,
  fps: number,
): Scene[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const middle = start + cursor + scene.duration / 2;
    cursor += Math.round(scene.duration * fps) / fps;
    const card = cards.find((c) => c.start <= middle && c.end > middle);
    if (scene.locked || !card) return scene;
    return { ...scene, panel_id: card.panel_id, beat: card.beat ?? "custom" };
  });
}
export function selectExcerpt(
  scenes: Scene[],
  settings: VideoSettings,
  start: number,
  end: number,
) {
  const fps = settings.fps,
    a = Math.round(start * fps) / fps,
    b = Math.round(end * fps) / fps;
  if (a < 0 || b > timelineSeconds(scenes, fps) + 0.001 || b - a < 0.25)
    throw new Error("Choose an excerpt inside the current timeline.");
  let cursor = 0;
  const result: Scene[] = [];
  for (const source of scenes) {
    const length = Math.round(source.duration * fps) / fps,
      left = Math.max(cursor, a),
      right = Math.min(cursor + length, b);
    if (right > left) {
      if (right - left < 0.25)
        throw new Error(
          "This excerpt leaves a shot shorter than 0.25 seconds. Adjust its ends.",
        );
      if (source.locked && Math.abs(right - left - length) > 0.001)
        throw new Error("Unlock the scene at the excerpt boundary first.");
      const time = cursor + (source.sfx_offset ?? 0),
        keep = time >= left && time < right;
      result.push({
        ...source,
        duration: right - left,
        sfx_offset: keep ? time - left : 0,
        sfx_id: keep ? source.sfx_id : null,
        clear_sfx: !keep,
        sfx_source_id: keep ? source.sfx_source_id : null,
        sfx_url: keep ? source.sfx_url : null,
      });
    }
    cursor += length;
  }
  return {
    scenes: result,
    settings: {
      ...settings,
      narration_start: settings.narration_start + a,
      narration_end: settings.narration_start + b,
    },
  };
}
export function framingWarnings(scene: Scene, project: Project): string[] {
  const ratio = scene.panel.width / scene.panel.height,
    visible = Math.min(ratio / (9 / 16), 9 / 16 / ratio);
  const warnings: string[] = [];
  if (visible < 0.65 && scene.framing !== "fit")
    warnings.push(
      "Much of this panel is cropped. Check dialogue and the action, or choose Read Panel / a closer crop.",
    );
  if (
    project.settings.captions &&
    (scene.caption || project.caption_cues?.length)
  )
    warnings.push(
      "Check that captions leave faces, dialogue, and the impact visible.",
    );
  if (scene.duration < 1 && (scene.caption?.split(/\s+/).length ?? 0) > 5)
    warnings.push("This caption may be too long for this quick shot.");
  return warnings;
}
