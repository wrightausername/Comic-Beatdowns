import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PageShotReview from "./PageShotReview";
import type { Scene } from "./types";

const image = {
  id: "page-1",
  title: "One whole comic page",
  width: 800,
  height: 800,
  image_url: "/page.jpg",
  thumbnail_url: "/page-thumb.jpg",
} as Scene["panel"];
const base: Scene = {
  id: "a",
  panel_id: "page-1",
  panel: image,
  position: 0,
  duration: 2,
  motion: "hold",
  motion_strength: 0.1,
  easing: "smooth",
  focus_x: 0.5,
  focus_y: 0.5,
  framing: "fit",
  transition: "cut",
  transition_duration: null,
  caption: "",
  sfx_url: null,
  source_crop: { x: 0.1, y: 0.1, width: 0.6, height: 0.6 },
};
const shots: Scene[] = [
  base,
  {
    ...base,
    id: "b",
    position: 1,
    duration: 1.5,
    source_crop: { x: 0.6, y: 0.15, width: 0.35, height: 0.4 },
  },
];
function pointer(
  element: Element,
  kind: "pointerdown" | "pointermove",
  x: number,
  y: number,
) {
  fireEvent(
    element,
    new MouseEvent(kind, { bubbles: true, clientX: x, clientY: y }),
  );
}

function setup(scenes: Scene[] = shots, canUndo = true) {
  const onPatch = vi.fn();
  const onMove = vi.fn();
  const onJoin = vi.fn();
  const onSplit = vi.fn();
  const onPreview = vi.fn();
  const onDuplicate = vi.fn();
  const onRemove = vi.fn();
  const onUndo = vi.fn();
  const props = {
    scenes,
    busy: false,
    canUndo,
    onPatch,
    onMove,
    onJoin,
    onSplit,
    onPreview,
    onDuplicate,
    onRemove,
    onUndo,
  };
  render(<PageShotReview {...props} />);
  return { ...props };
}

describe("plain language whole-page editor", () => {
  it("shows a real page image, crop, timing and explicit controls to fix Verdict", () => {
    const result = setup();
    expect(
      screen.getByRole("group", { name: "Full source page for shot 1" }),
    ).toContainElement(screen.getByAltText("One whole comic page"));
    expect(
      screen.getByRole("button", { name: "Review shot 1" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Pan across" }));
    expect(result.onPatch).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        motion: "panel_glide",
        framing: "fit",
        glide_start: 0,
        glide_end: 1,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show more art" }));
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      source_crop: expect.objectContaining({ width: 0.672 }),
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Shot 1 duration" }),
      {
        target: { value: "3.25" },
      },
    );
    expect(result.onPatch).toHaveBeenCalledWith(0, { duration: 3.25 });
    fireEvent.click(screen.getByRole("button", { name: "Preview this shot" }));
    expect(result.onPreview).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Undo edit" }));
    expect(result.onUndo).toHaveBeenCalledTimes(1);
  });

  it("lets the creator move shots, split or join, and choose transitions", () => {
    const result = setup();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(result.onMove).toHaveBeenCalledWith(0, 1);
    fireEvent.click(screen.getByRole("button", { name: "Split shot in two" }));
    expect(result.onSplit).toHaveBeenCalledWith(0);
    fireEvent.click(
      screen.getByRole("button", { name: "Join with next shot" }),
    );
    expect(result.onJoin).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Review shot 2" }));
    expect(
      screen.getByRole("button", { name: "Review shot 2" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Shot 2 transition" }),
      {
        target: { value: "crossfade" },
      },
    );
    expect(result.onPatch).toHaveBeenCalledWith(1, { transition: "crossfade" });
    fireEvent.click(screen.getByRole("button", { name: "Earlier" }));
    expect(result.onMove).toHaveBeenCalledWith(1, 0);
  });

  it("lets the creator drag the source crop directly and use keyboard nudges", () => {
    const result = setup();
    const page = screen.getByRole("group", {
      name: "Full source page for shot 1",
    });
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        width: 400,
        height: 400,
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
      }),
    });
    const crop = screen.getByRole("button", {
      name: /Drag selected crop to move it/,
    });
    pointer(crop, "pointerdown", 100, 100);
    pointer(page, "pointermove", 140, 120);
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      source_crop: { x: 0.2, y: 0.15, width: 0.6, height: 0.6 },
    });
    fireEvent.pointerUp(page, { pointerId: 1 });
    fireEvent.keyDown(crop, { key: "ArrowRight" });
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      source_crop: { x: 0.11, y: 0.1, width: 0.6, height: 0.6 },
    });
    fireEvent.click(screen.getByRole("button", { name: "Draw new crop" }));
    pointer(page, "pointerdown", 60, 100);
    pointer(page, "pointermove", 300, 300);
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      source_crop: { x: 0.15, y: 0.25, width: 0.6, height: 0.5 },
    });
  });

  it("draws a numbered 1→2 route on the original page and adjusts speed", () => {
    const result = setup();
    const page = screen.getByRole("group", {
      name: "Full source page for shot 1",
    });
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        width: 400,
        height: 400,
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
      }),
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Draw 1 → 2 camera route" }),
    );
    pointer(page, "pointerdown", 140, 160);
    expect(
      screen.getByText("Click where the camera should END (point 2)."),
    ).toBeInTheDocument();
    pointer(page, "pointerdown", 280, 280);
    expect(result.onPatch).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        motion: "panel_glide",
        camera_path: [
          { x: 0.416667, y: 0.5 },
          { x: 1, y: 1 },
        ],
      }),
    );
  });

  it("lets the creator drag numbered dots and pick a travel speed", () => {
    const route = [
      { x: 0.1, y: 0.25 },
      { x: 0.9, y: 0.75 },
    ];
    const result = setup([
      { ...shots[0], camera_path: route, motion: "panel_glide" },
    ]);
    const page = screen.getByRole("group", {
      name: "Full source page for shot 1",
    });
    Object.defineProperty(page, "getBoundingClientRect", {
      value: () => ({
        width: 400,
        height: 400,
        left: 0,
        top: 0,
        right: 400,
        bottom: 400,
      }),
    });
    const start = screen.getByRole("button", { name: /Move camera point 1/ });
    pointer(start, "pointerdown", 60, 100);
    pointer(page, "pointermove", 220, 220);
    expect(result.onPatch).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        camera_path: [
          { x: 0.75, y: 0.75 },
          { x: 0.9, y: 0.75 },
        ],
      }),
    );
    fireEvent.pointerUp(page, { pointerId: 1 });
    fireEvent.change(
      screen.getByRole("slider", { name: "Shot 1 camera travel time" }),
      { target: { value: "0.35" } },
    );
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      path_move_fraction: 0.35,
    });
    fireEvent.click(screen.getByRole("button", { name: "Reverse route" }));
    expect(result.onPatch).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        camera_path: [route[1], route[0]],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear route" }));
    expect(result.onPatch).toHaveBeenCalledWith(
      0,
      expect.objectContaining({
        motion: "hold",
        camera_path: null,
      }),
    );
  });

  it("prevents modifying locked source shots or unsafe joins", () => {
    const result = setup(
      [
        { ...shots[0], locked: true },
        { ...shots[1], caption: "Voice text" },
      ],
      false,
    );
    expect(screen.getByRole("button", { name: "Pan across" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Join with next shot" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo edit" })).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock this shot to edit it" }),
    );
    expect(result.onPatch).toHaveBeenCalledWith(0, { locked: false });
  });

  it("replaces a crop with the original full page without deleting the source", () => {
    const result = setup();
    fireEvent.click(
      screen.getByRole("button", { name: "Use complete page instead" }),
    );
    expect(result.onPatch).toHaveBeenCalledWith(0, {
      source_crop: null,
      motion: "hold",
      framing: "fit",
      glide_axis: null,
      glide_start: 0,
      glide_end: 1,
      camera_path: null,
    });
  });
});
