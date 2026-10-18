import { describe, expect, it } from "vitest";
import {
  CAMERA_MOVES,
  TRANSITIONS,
  blendFrames,
  cameraPosition,
  transitionStyles,
} from "./effects";
import type { CameraSettings } from "./effects";

const base: CameraSettings = {
  motion: "zoom_in",
  motion_strength: 0.1,
  easing: "smooth",
  focus_x: 0.5,
  focus_y: 0.5,
};
describe("camera and transition preview", () => {
  it("provides the expanded camera and transition catalogs", () => {
    expect(CAMERA_MOVES).toHaveLength(20);
    expect(TRANSITIONS).toHaveLength(12);
  });
  it("keeps every path inside the image across all easing choices", () => {
    for (const { value } of CAMERA_MOVES)
      for (const easing of ["linear", "smooth", "ease_in", "ease_out"] as const)
        for (const t of [0, 0.05, 0.5, 0.95, 1]) {
          const frame = cameraPosition({ ...base, motion: value, easing }, t);
          expect(frame.zoom).toBeGreaterThanOrEqual(1);
          expect(frame.zoom).toBeLessThanOrEqual(1.100001);
          expect(frame.x).toBeGreaterThanOrEqual(0);
          expect(frame.x).toBeLessThanOrEqual(1);
          expect(frame.y).toBeGreaterThanOrEqual(0);
          expect(frame.y).toBeLessThanOrEqual(1);
        }
  });
  it("matches camera directions and finishes quick punch-ins early", () => {
    expect(cameraPosition({ ...base, motion: "pan_up" }, 0).y).toBe(1);
    expect(cameraPosition({ ...base, motion: "pan_up" }, 1).y).toBe(0);
    expect(
      cameraPosition({ ...base, motion: "punch_in" }, 0.2).zoom,
    ).toBeCloseTo(1.1);
    expect(cameraPosition({ ...base, motion: "breathe" }, 1).zoom).toBeCloseTo(
      1,
    );
  });
  it("bounds transitions on short scenes and skips the first scene", () => {
    const scene = { duration: 0.25 },
      settings = {
        fps: 24,
        transition: "crossfade" as const,
        transition_duration: 0.8,
      };
    expect(blendFrames(scene, undefined, settings)).toBe(0);
    expect(blendFrames(scene, { duration: 10 }, settings)).toBe(3);
    expect(
      blendFrames({ ...scene, transition: "cut" }, { duration: 10 }, settings),
    ).toBe(0);
  });
  it("fades through black and reveals wipes at the correct end", () => {
    expect(transitionStyles("fade", 0.5)).toEqual({
      previous: { opacity: 0 },
      current: { opacity: 0 },
    });
    expect(transitionStyles("wipe_left", 1).current.clipPath).toBe(
      "inset(0 0 0 0%)",
    );
  });
});
