import { describe, expect, it } from "vitest";
import {
  cameraFocalToViewport,
  cameraPathZoom,
  interpolateCameraRoute,
  pagePointToRoute,
} from "./cameraRoute";

describe("numbered camera route geometry", () => {
  it("uses the same non-stretched art viewport as FFmpeg", () => {
    const zoom = cameraPathZoom(3);
    expect(zoom).toBeCloseTo(7.466667, 4);
    const start = cameraFocalToViewport({ x: 0.1, y: 0.5 }, 3, zoom);
    const end = cameraFocalToViewport({ x: 0.9, y: 0.5 }, 3, zoom);
    expect(start.x).toBeLessThan(0.2);
    expect(end.x).toBeGreaterThan(0.8);
    expect(start.y).toBeCloseTo(0.5);
    expect(end.y).toBeCloseTo(0.5);
  });

  it("interpolates through numbered points, not diagonally past middle stops", () => {
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
    ];
    const aspect = 0.75;
    const zoom = cameraPathZoom(aspect, 2);
    const start = interpolateCameraRoute(points, aspect, zoom, 0);
    const middle = interpolateCameraRoute(points, aspect, zoom, 0.5);
    const end = interpolateCameraRoute(points, aspect, zoom, 1);
    expect(middle.x).toBeCloseTo(end.x);
    expect(middle.y).toBeCloseTo(start.y);
    expect(end.y).toBeGreaterThan(start.y);
    expect(start.x).toBeLessThan(end.x);
  });

  it("converts whole-page clicks to crop-relative route points", () => {
    const crop = { x: 0.2, y: 0.3, width: 0.4, height: 0.5 };
    expect(pagePointToRoute(0.4, 0.55, crop)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(pagePointToRoute(0.9, 0.95, crop)).toEqual({ x: 1, y: 1 });
  });
});
