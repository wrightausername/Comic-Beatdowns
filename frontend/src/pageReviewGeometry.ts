/** Reversible, bounded crop controls for original-page virtual shots. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
const MIN_SIZE = 0.03;
const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

export function moveCrop(region: Region, dx: number, dy: number): Region {
  return {
    ...region,
    x: round(clamp(region.x + dx, 0, 1 - region.width)),
    y: round(clamp(region.y + dy, 0, 1 - region.height)),
  };
}

export function resizeCrop(region: Region, dx: number, dy: number): Region {
  return {
    ...region,
    width: round(clamp(region.width + dx, MIN_SIZE, 1 - region.x)),
    height: round(clamp(region.height + dy, MIN_SIZE, 1 - region.y)),
  };
}

export function drawCrop(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): Region | null {
  const left = clamp(Math.min(x1, x2), 0, 1);
  const right = clamp(Math.max(x1, x2), 0, 1);
  const top = clamp(Math.min(y1, y2), 0, 1);
  const bottom = clamp(Math.max(y1, y2), 0, 1);
  if (right - left < MIN_SIZE || bottom - top < MIN_SIZE) return null;
  return {
    x: round(left),
    y: round(top),
    width: round(right - left),
    height: round(bottom - top),
  };
}

/** factor > 1 reveals more surrounding art; factor < 1 tightens around the center. */
export function scaleCrop(region: Region, factor: number): Region {
  const width = clamp(region.width * factor, MIN_SIZE, 1);
  const height = clamp(region.height * factor, MIN_SIZE, 1);
  const x = clamp(region.x + (region.width - width) / 2, 0, 1 - width);
  const y = clamp(region.y + (region.height - height) / 2, 0, 1 - height);
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}
