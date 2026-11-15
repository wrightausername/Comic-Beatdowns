import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import GuidedWorkspace, { guidedState } from "./GuidedWorkspace";
import type { Project, RenderJob, Scene } from "./types";

const project = {
  id: "episode-a",
  revision: 4,
  narration_url: null,
  scene_count: 0,
  script_approved: false,
  workflow: { panel_ids: [] },
} as unknown as Project;
const scene = { id: "scene-a" } as Scene;
const renderJob = {
  id: "render-a",
  project_id: "episode-a",
  project_revision: 4,
  status: "completed",
  quality: "draft",
  download_url: "/api/renders/render-a/download",
} as RenderJob;

it("guides users in the correct order and ignores outdated previews", () => {
  expect(guidedState(project, [], [], false)).toBe("files");
  const withPanels = { ...project, scene_count: 1 };
  expect(guidedState(withPanels, [scene], [], false)).toBe("files");
  const ready = { ...withPanels, narration_url: "/media/voice.wav" };
  expect(guidedState(ready, [scene], [], false)).toBe("generate");
  expect(guidedState(ready, [scene], [], true)).toBe("save");
  expect(
    guidedState(ready, [scene], [{ ...renderJob, status: "running" }], false),
  ).toBe("working");
  expect(guidedState(ready, [scene], [renderJob], false)).toBe("review");
  expect(
    guidedState(ready, [scene], [{ ...renderJob, project_revision: 3 }], false),
  ).toBe("generate");
  expect(
    guidedState({ ...ready, script_approved: true }, [scene], [], false),
  ).toBe("export");
  expect(
    guidedState(ready, [scene], [{ ...renderJob, quality: "final" }], false),
  ).toBe("done");
});

it("offers one clear next action with a way to return to the full editor", () => {
  const onFiles = vi.fn();
  const onAdvanced = vi.fn();
  const onAutopilot = vi.fn();
  const onGenerate = vi.fn();
  const base = {
    project,
    scenes: [] as Scene[],
    jobs: [] as RenderJob[],
    dirty: false,
    busy: false,
    canRender: false,
    onFiles,
    onAutopilot,
    onGenerate,
    onSave: vi.fn(),
    onReview: vi.fn(),
    onRender: vi.fn(),
    onAdvanced,
  };
  const view = render(<GuidedWorkspace {...base} />);
  fireEvent.click(screen.getByRole("button", { name: "Add missing files" }));
  expect(onFiles).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Open full editor" }));
  expect(onAdvanced).toHaveBeenCalledTimes(1);

  view.rerender(
    <GuidedWorkspace
      {...base}
      project={{
        ...project,
        narration_url: "/media/voice.wav",
        scene_count: 1,
      }}
      scenes={[scene]}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Make my video preview" }),
  );
  expect(onGenerate).toHaveBeenCalledTimes(1);
  expect(onAutopilot).not.toHaveBeenCalled();
  expect(screen.queryByText(/not visual AI/i)).not.toBeInTheDocument();
});
