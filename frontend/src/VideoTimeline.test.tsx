import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import VideoTimeline from "./VideoTimeline";
import type { Project, Scene } from "./types";
vi.mock("./api", () => ({
  api: vi.fn().mockResolvedValue({ duration: 4, peaks: [], pauses: [] }),
}));
const scenes = [0, 1].map((i) => ({
  id: `s${i}`,
  panel_id: `p${i}`,
  duration: 2,
  motion: "hold",
  transition: "cut",
  panel: { title: `Panel ${i}`, thumbnail_url: `/p${i}.png` },
  sfx_id: i ? "hit" : null,
  sfx_offset: 0.5,
})) as Scene[];
const project = {
  id: "p",
  settings: {
    fps: 24,
    narration_start: 1,
    narration_end: 5,
    captions: true,
    transition: "cut",
    voice_volume: 1,
    music_volume: 0.12,
    sfx_volume: 0.35,
    duck_audio: true,
  },
  narration_url: "/voice.wav",
  narration_duration: 5,
  music_url: "/music.wav",
  caption_cues: [{ start: 2, end: 3, text: "Real timed words" }],
} as Project;
function setup(values = scenes, cursor = 1) {
  const onChange = vi.fn(),
    onSeek = vi.fn();
  render(
    <VideoTimeline
      project={project}
      scenes={values}
      effects={[
        {
          id: "hit",
          name: "Impact",
          duration: 0.4,
          url: "/hit.wav",
          kind: "impact",
        },
      ]}
      cursor={cursor}
      disabled={false}
      onChange={onChange}
      onSeek={onSeek}
    />,
  );
  return { onChange, onSeek };
}
it("draws real timed tracks and seeks from captions and shots", () => {
  const { onSeek } = setup();
  fireEvent.click(screen.getByText("Real timed words"));
  expect(onSeek).toHaveBeenLastCalledWith(1);
  expect(
    screen.getByRole("button", { name: "Real timed words" }).style.left,
  ).toBe("25%");
  expect(screen.getByRole("button", { name: "Impact" }).style.left).toBe(
    "62.5%",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Timeline shot 2: Panel 1" }),
  );
  expect(onSeek).toHaveBeenLastCalledWith(2);
});
it("edits and splits real scenes while preserving duration and source", () => {
  const { onChange } = setup();
  fireEvent.change(screen.getByLabelText("Timeline shot camera"), {
    target: { value: "punch_in" },
  });
  expect(onChange.mock.calls[0][0][0].motion).toBe("punch_in");
  expect(scenes[0].motion).toBe("hold");
  fireEvent.click(screen.getByText("Split shot at playhead"));
  const result = onChange.mock.lastCall![0] as Scene[];
  expect(result.map((s) => s.duration)).toEqual([1, 1, 2]);
  expect(result[0].id).toBe("s0");
  expect(result[1].id).not.toBe("s0");
});
it("protects locked shots and adjacent cut timing", () => {
  const { onChange } = setup([{ ...scenes[0], locked: true }, scenes[1]]);
  expect(screen.getByLabelText("Timeline shot camera")).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText("Cut after scene 1"), {
    key: "ArrowRight",
  });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Timeline shot 2: Panel 1" }),
  );
  expect(screen.getByText("Move shot earlier")).toBeDisabled();
});

it("exposes direct trim handles with frame-accurate cut editing", () => {
  const { onChange } = setup();
  fireEvent.keyDown(screen.getByLabelText("Trim right edge of shot 1"), {
    key: "ArrowRight",
  });
  expect(onChange.mock.lastCall![0].map((s: Scene) => s.duration)).toEqual([
    49 / 24,
    47 / 24,
  ]);
});
it("edits caption text and audio settings through the saved workspace contract", () => {
  const onProjectChange = vi.fn();
  render(
    <VideoTimeline
      project={project}
      scenes={scenes}
      effects={[]}
      cursor={0}
      disabled={false}
      onChange={vi.fn()}
      onSeek={vi.fn()}
      onProjectChange={onProjectChange}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Caption editor" }));
  fireEvent.change(screen.getByLabelText("Timeline caption words"), {
    target: { value: "Edited timing words" },
  });
  expect(onProjectChange.mock.lastCall![0].cues[0]).toMatchObject({
    start: 2,
    end: 3,
    text: "Edited timing words",
  });
  fireEvent.click(screen.getByRole("tab", { name: "Audio mixer" }));
  fireEvent.change(screen.getByLabelText("Timeline narration volume"), {
    target: { value: "0.4" },
  });
  expect(onProjectChange.mock.lastCall![0].settings.voice_volume).toBe(0.4);
});
