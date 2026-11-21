/** Camera route geometry shared by React preview and saved shot controls.
 * All route points are relative to the selected source window, not screen pixels.
 * Backend app/camera_path.py implements the matching FFmpeg calculations.
 */
export interface CameraWaypoint {
  x: number;
  y: number;
}
const VIEW = 9 / 16;
const clamp = (n: number, low = 0, high = 1) =>
  Math.max(low, Math.min(high, n));

export function cameraPathZoom(aspect: number, multiplier = 1.4) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  const base = Math.max(1, aspect / VIEW, VIEW / aspect);
  return Math.min(8, base * clamp(multiplier, 1, 2));
}

/** Transform a clicked point on source art into a safe FFmpeg zoompan origin. */
export function cameraFocalToViewport(
  point: CameraWaypoint,
  aspect: number,
  zoom: number,
): CameraWaypoint {
  const width = aspect >= VIEW ? 1 : aspect / VIEW;
  const height = aspect >= VIEW ? VIEW / aspect : 1;
  const viewport = 1 / Math.max(1, zoom);
  const axis = (value: number, size: number) => {
    const offset = (1 - size) / 2;
    const low = offset;
    const high = offset + size - viewport;
    if (high < low) return 0.5;
    const center = offset + clamp(value) * size;
    const left = clamp(center - viewport / 2, low, high);
    return clamp(left / Math.max(0.000000001, 1 - viewport));
  };
  return { x: axis(point.x, width), y: axis(point.y, height) };
}

/** Travel each segment proportionally to its length rather than pausing at short steps. */
export function interpolateCameraRoute(
  points: CameraWaypoint[],
  aspect: number,
  zoom: number,
  progress: number,
): CameraWaypoint {
  if (!points.length) return { x: 0.5, y: 0.5 };
  if (points.length === 1) return cameraFocalToViewport(points[0], aspect, zoom);
  const locations = points.map((point) => cameraFocalToViewport(point, aspect, zoom));
  const distance = points.slice(1).map((point, i) =>
    Math.max(0.000001, Math.hypot(point.x - points[i].x, point.y - points[i].y)),
  );
  const total = distance.reduce((a, b) => a + b, 0);
  let elapsed = 0;
  const t = clamp(progress);
  for (let index = 0; index < distance.length; index++) {
    const portion = distance[index] / total;
    if (t <= elapsed + portion || index === distance.length - 1) {
      const share = clamp((t - elapsed) / portion);
      const from = locations[index];
      const to = locations[index + 1];
      return {
        x: from.x + (to.x - from.x) * share,
        y: from.y + (to.y - from.y) * share,
      };
    }
    elapsed += portion;
  }
  return locations[locations.length - 1];
}

/** Convert a creator click on the full original page into crop-relative path coordinates. */
export function pagePointToRoute(
  x: number,
  y: number,
  crop: { x: number; y: number; width: number; height: number },
): CameraWaypoint {
  return {
    x: Math.round(clamp((x - crop.x) / crop.width) * 1_000_000) / 1_000_000,
    y: Math.round(clamp((y - crop.y) / crop.height) * 1_000_000) / 1_000_000,
  };
}
