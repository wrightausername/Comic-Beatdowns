import type { Scene } from "./types";
import { newId } from "./editing";

export function moveTimelineShot(
  scenes: Scene[],
  from: number,
  to: number,
): Scene[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= scenes.length ||
    to >= scenes.length ||
    scenes
      .slice(Math.min(from, to), Math.max(from, to) + 1)
      .some((s) => s.locked)
  )
    return scenes;
  const result = [...scenes];
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}

// Keep-length trimming rolls the shared cut. Ripple trimming changes video
// length; a later locked shot must never silently shift in time.
export function trimTimelineShot(
  scenes: Scene[],
  index: number,
  edge: "left" | "right",
  delta: number,
  fps: number,
  keepLength = true,
): Scene[] {
  const shot = scenes[index];
  if (!shot || shot.locked) return scenes;
  const frames = Math.round(shot.duration * fps),
    minimum = Math.ceil(0.25 * fps),
    maximum = 30 * fps;
  const neighbor = index + (edge === "right" ? 1 : -1);
  const direction = edge === "right" ? 1 : -1;
  let change = Math.round(delta) * direction;
  if (keepLength) {
    if (!scenes[neighbor] || scenes[neighbor].locked) return scenes;
    const other = Math.round(scenes[neighbor].duration * fps);
    change = Math.max(
      minimum - frames,
      other - maximum,
      Math.min(maximum - frames, other - minimum, change),
    );
    return scenes.map((s, i) =>
      i === index
        ? { ...s, duration: (frames + change) / fps }
        : i === neighbor
          ? { ...s, duration: (other - change) / fps }
          : s,
    );
  }
  if (scenes.slice(index + 1).some((s) => s.locked)) return scenes;
  change = Math.max(
    minimum - frames,
    Math.min(
      maximum - frames,
      180 * fps -
        scenes.reduce((sum, s) => sum + Math.round(s.duration * fps), 0),
      change,
    ),
  );
  return scenes.map((s, i) =>
    i === index ? { ...s, duration: (frames + change) / fps } : s,
  );
}

export function deleteTimelineShots(
  scenes: Scene[],
  ids: Set<string>,
): Scene[] {
  const first = scenes.findIndex((s) => ids.has(s.id!));
  if (first < 0 || scenes.slice(first).some((s) => s.locked)) return scenes;
  return scenes.filter((s) => !ids.has(s.id!));
}

export function duplicateTimelineShot(scenes: Scene[], index: number): Scene[] {
  const s = scenes[index];
  if (
    !s ||
    scenes.slice(index).some((s) => s.locked) ||
    scenes.reduce((sum, shot) => sum + shot.duration, 0) + s.duration > 180
  )
    return scenes;
  return [
    ...scenes.slice(0, index + 1),
    { ...s, id: newId(), sfx_source_id: s.sfx_source_id ?? s.id },
    ...scenes.slice(index + 1),
  ];
}

export function snapTimelineTime(
  value: number,
  targets: number[],
  tolerance: number,
  fps: number,
): number {
  const target = targets.reduce(
    (best, t) => (Math.abs(t - value) < Math.abs(best - value) ? t : best),
    value + tolerance + 1,
  );
  return (
    Math.round((Math.abs(target - value) <= tolerance ? target : value) * fps) /
    fps
  );
}
