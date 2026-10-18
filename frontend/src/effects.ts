import type { CSSProperties } from "react";

export const CAMERA_MOVES = [
  { value: "hold", label: "Hold frame", group: "Still & zoom" },
  { value: "zoom_in", label: "Slow push in", group: "Still & zoom" },
  { value: "zoom_out", label: "Pull back", group: "Still & zoom" },
  {
    value: "punch_in",
    label: "Quick punch in · then hold",
    group: "Still & zoom",
  },
  {
    value: "punch_out",
    label: "Quick pull out · then hold",
    group: "Still & zoom",
  },
  {
    value: "breathe",
    label: "Gentle breathe · in and back",
    group: "Still & zoom",
  },
  { value: "pan_left", label: "Pan left", group: "Pans" },
  { value: "pan_right", label: "Pan right", group: "Pans" },
  { value: "pan_up", label: "Pan up", group: "Pans" },
  { value: "pan_down", label: "Pan down", group: "Pans" },
  { value: "drift_up_left", label: "Drift up left", group: "Diagonal drifts" },
  {
    value: "drift_up_right",
    label: "Drift up right",
    group: "Diagonal drifts",
  },
  {
    value: "drift_down_left",
    label: "Drift down left",
    group: "Diagonal drifts",
  },
  {
    value: "drift_down_right",
    label: "Drift down right",
    group: "Diagonal drifts",
  },
  {
    value: "push_left",
    label: "Push in + move left",
    group: "Moving pushes & pulls",
  },
  {
    value: "push_right",
    label: "Push in + move right",
    group: "Moving pushes & pulls",
  },
  {
    value: "push_up",
    label: "Push in + move up",
    group: "Moving pushes & pulls",
  },
  {
    value: "push_down",
    label: "Push in + move down",
    group: "Moving pushes & pulls",
  },
  {
    value: "pull_left",
    label: "Pull back + move left",
    group: "Moving pushes & pulls",
  },
  {
    value: "pull_right",
    label: "Pull back + move right",
    group: "Moving pushes & pulls",
  },
] as const;

export const TRANSITIONS = [
  { value: "cut", label: "Hard cut", group: "Clean cuts & fades" },
  { value: "crossfade", label: "Crossfade", group: "Clean cuts & fades" },
  { value: "fade", label: "Dip to black", group: "Clean cuts & fades" },
  { value: "dip_white", label: "Dip to white", group: "Clean cuts & fades" },
  { value: "slide_left", label: "Slide left", group: "Slides" },
  { value: "slide_right", label: "Slide right", group: "Slides" },
  { value: "slide_up", label: "Slide up", group: "Slides" },
  { value: "slide_down", label: "Slide down", group: "Slides" },
  { value: "smooth_left", label: "Soft slide left", group: "Slides" },
  { value: "smooth_right", label: "Soft slide right", group: "Slides" },
  { value: "wipe_left", label: "Wipe left", group: "Wipes" },
  { value: "wipe_right", label: "Wipe right", group: "Wipes" },
] as const;

export type Motion = (typeof CAMERA_MOVES)[number]["value"];
export type Transition = (typeof TRANSITIONS)[number]["value"];
export type Easing = "linear" | "smooth" | "ease_in" | "ease_out";
export interface CameraSettings {
  motion: Motion;
  motion_strength: number;
  easing: Easing;
  focus_x: number;
  focus_y: number;
}
export const CAMERA_PRESETS: { name: string; settings: CameraSettings }[] = [
  {
    name: "Subtle push",
    settings: {
      motion: "zoom_in",
      motion_strength: 0.06,
      easing: "smooth",
      focus_x: 0.5,
      focus_y: 0.5,
    },
  },
  {
    name: "Follow the action",
    settings: {
      motion: "pan_left",
      motion_strength: 0.12,
      easing: "smooth",
      focus_x: 0.5,
      focus_y: 0.5,
    },
  },
  {
    name: "Impact beat",
    settings: {
      motion: "punch_in",
      motion_strength: 0.16,
      easing: "ease_out",
      focus_x: 0.5,
      focus_y: 0.5,
    },
  },
  {
    name: "Still frame",
    settings: {
      motion: "hold",
      motion_strength: 0.1,
      easing: "linear",
      focus_x: 0.5,
      focus_y: 0.5,
    },
  },
];

const clamp = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (t: number) => t * t * (3 - 2 * t);
export function cameraPosition(scene: CameraSettings, ratio: number) {
  let t = clamp(ratio);
  if (scene.motion.startsWith("punch_")) t = clamp(t / 0.18);
  if (scene.easing === "smooth") t = smooth(t);
  else if (scene.easing === "ease_in") t *= t;
  else if (scene.easing === "ease_out") t = 1 - (1 - t) ** 2;
  const strength = scene.motion_strength ?? 0.1;
  const fx = scene.focus_x ?? 0.5,
    fy = scene.focus_y ?? 0.5;
  let zoom = 1,
    x = fx,
    y = fy;
  if (
    ["zoom_in", "punch_in"].includes(scene.motion) ||
    scene.motion.startsWith("push_")
  )
    zoom += strength * t;
  else if (
    ["zoom_out", "punch_out"].includes(scene.motion) ||
    scene.motion.startsWith("pull_")
  )
    zoom += strength * (1 - t);
  else if (scene.motion === "breathe") zoom += strength * Math.sin(Math.PI * t);
  else if (scene.motion.startsWith("pan_") || scene.motion.startsWith("drift_"))
    zoom += strength;
  if (scene.motion.endsWith("left"))
    x = clamp(fx + 0.5) + (clamp(fx - 0.5) - clamp(fx + 0.5)) * t;
  else if (scene.motion.endsWith("right"))
    x = clamp(fx - 0.5) + (clamp(fx + 0.5) - clamp(fx - 0.5)) * t;
  if (scene.motion.includes("_up"))
    y = clamp(fy + 0.5) + (clamp(fy - 0.5) - clamp(fy + 0.5)) * t;
  else if (scene.motion.includes("_down"))
    y = clamp(fy - 0.5) + (clamp(fy + 0.5) - clamp(fy - 0.5)) * t;
  return { zoom, x, y };
}

export function cameraStyle(
  scene: CameraSettings,
  ratio: number,
): CSSProperties {
  const { zoom, x, y } = cameraPosition(scene, ratio);
  return {
    objectPosition: `${scene.focus_x * 100}% ${scene.focus_y * 100}%`,
    transformOrigin: "0 0",
    transform: `translate(${-x * (zoom - 1) * 100}%, ${-y * (zoom - 1) * 100}%) scale(${zoom})`,
  };
}

export function blendFrames(
  scene: {
    duration: number;
    transition?: Transition | null;
    transition_duration?: number | null;
  },
  previous: { duration: number } | undefined,
  settings: {
    fps: number;
    transition: Transition;
    transition_duration: number;
  },
) {
  const effect = scene.transition ?? settings.transition;
  if (!previous || effect === "cut") return 0;
  const requested = Math.round(
    (scene.transition_duration ?? settings.transition_duration ?? 0.25) *
      settings.fps,
  );
  const cap = Math.max(
    1,
    Math.floor(
      (Math.min(scene.duration, previous.duration) * settings.fps) / 2,
    ),
  );
  return Math.min(Math.max(1, requested), cap);
}

export function transitionStyles(
  effect: Transition,
  ratio: number,
): { previous: CSSProperties; current: CSSProperties } {
  const t = clamp(ratio);
  if (effect === "crossfade") return { previous: {}, current: { opacity: t } };
  if (effect === "fade" || effect === "dip_white")
    return {
      previous: { opacity: Math.max(0, 1 - 2 * t) },
      current: { opacity: Math.max(0, 2 * t - 1) },
    };
  if (effect === "wipe_left")
    return {
      previous: {},
      current: { clipPath: `inset(0 0 0 ${(1 - t) * 100}%)` },
    };
  if (effect === "wipe_right")
    return {
      previous: {},
      current: { clipPath: `inset(0 ${(1 - t) * 100}% 0 0)` },
    };
  if (effect.startsWith("slide_") || effect.startsWith("smooth_")) {
    const p = effect.startsWith("smooth_") ? smooth(t) : t;
    const direction = effect.endsWith("left") || effect.endsWith("up") ? -1 : 1;
    const axis = effect.endsWith("up") || effect.endsWith("down") ? "Y" : "X";
    return {
      previous: { transform: `translate${axis}(${direction * p * 100}%)` },
      current: {
        transform: `translate${axis}(${-direction * (1 - p) * 100}%)`,
      },
    };
  }
  return { previous: { opacity: 0 }, current: {} };
}

export const transitionLabel = (value: Transition) =>
  TRANSITIONS.find((t) => t.value === value)?.label ?? value;
