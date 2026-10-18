import type { Scene } from "./types";

export const timecode = (seconds: number) =>
  `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
export const spokenSeconds = (script: string) =>
  Math.round(script.trim().split(/\s+/).filter(Boolean).length / 2.7);
export const timelineSeconds = (scenes: Scene[], fps: number) =>
  scenes.reduce(
    (sum, s) => sum + Math.max(1, Math.round(s.duration * fps)),
    0,
  ) / fps;
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length)
    return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
