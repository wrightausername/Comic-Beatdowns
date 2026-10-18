import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VideoOptions } from "./dialogs";
import type { VideoSettings } from "./types";

it("updates the template transition while retaining other production settings", () => {
  const value: VideoSettings = {
    fps: 24,
    transition: "fade",
    captions: true,
    default_duration: 5,
    default_motion: "zoom_in",
    transition_duration: 0.25,
    default_motion_strength: 0.1,
    default_easing: "smooth",
  };
  const onChange = vi.fn();
  render(<VideoOptions value={value} onChange={onChange} />);
  expect(
    (
      screen.getByLabelText("Transition duration (seconds)") as HTMLInputElement
    ).checkValidity(),
  ).toBe(true);
  fireEvent.change(screen.getByLabelText("Transition"), {
    target: { value: "cut" },
  });
  expect(onChange).toHaveBeenCalledWith({ ...value, transition: "cut" });
});
