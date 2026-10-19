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
    edit_pace: "fast",
    narration_start: 0,
    narration_end: null,
    normalize_voice: true,
    voice_volume: 1,
    sfx_volume: 0.35,
    music_volume: 0.12,
    duck_audio: true,
    caption_font_size: 62,
    caption_color: "#FFFFFF",
    caption_accent: "#00E5F5",
    caption_style: "outline",
    caption_position: "bottom",
    logo_position: "top_right",
    logo_width: 180,
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
