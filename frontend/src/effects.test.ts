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
    expect(CAMERA_MOVES).toHaveLength(22);
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
  it("moves once across the intact long panel in reading direction", () => {
    const wide = {
      ...base,
      motion: "panel_glide" as const,
      panel: {
        id: "virtual",
        title: "Wide",
        series: "",
        issue: "",
        page: 1,
        characters: "",
        fight: "",
        width: 900,
        height: 300,
        source_name: "page.png",
        parent_id: null,
        created_at: "",
        image_url: "",
        thumbnail_url: "",
      },
      source_crop: { x: 0, y: 0, width: 1, height: 1 },
      glide_axis: "horizontal" as const,
      glide_start: 0.25,
      glide_end: 0.75,
    };
    const start = cameraPosition(wide, 0);
    const finish = cameraPosition(wide, 1);
    expect(start.zoom).toBeGreaterThan(4);
    expect(start.x).toBeCloseTo(0.25);
    expect(finish.x).toBeCloseTo(0.75);
  });
  it("follows numbered path speed and holds on the last stop until audio finishes", () => {
    const path = {
      ...base,
      motion: "panel_glide" as const,
      panel: {
        id: "page", title: "Page", width: 900, height: 300,
      } as CameraSettings["panel"],
      source_crop: { x: 0, y: 0, width: 1, height: 1 },
      camera_path: [
        { x: 0.1, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
      path_move_fraction: 0.4,
      path_zoom: 1.4,
    };
    const first = cameraPosition(path, 0);
    const middle = cameraPosition(path, 0.2);
    const end = cameraPosition(path, 0.4);
    const held = cameraPosition(path, 0.9);
    expect(first.x).toBeLessThan(middle.x);
    expect(middle.x).toBeLessThan(end.x);
    expect(held.x).toBeCloseTo(end.x);
    expect(held.y).toBeCloseTo(end.y);
    expect(end.zoom).toBeGreaterThan(5);
    // Split a route into two timeline shots without returning to point 1.
    const half = cameraPosition({ ...path, glide_start: 0.5, glide_end: 1 }, 0);
    expect(half.x).toBeCloseTo(end.x);
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
