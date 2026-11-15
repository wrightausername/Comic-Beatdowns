import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SceneFeedback from "./SceneFeedback";
import type { Project } from "./types";

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));
vi.mock("./api", () => ({
  api: mockApi,
  json: (value: unknown) => ({ method: "POST", body: JSON.stringify(value) }),
}));

const saved = {
  id: "episode-1",
  revision: 7,
  scenes: [{ id: "scene-1" }],
} as unknown as Project;

beforeEach(() => mockApi.mockReset());

function setup(onSave = vi.fn().mockResolvedValue(saved)) {
  render(
    <SceneFeedback
      projectId="episode-1"
      sceneId="scene-1"
      index={0}
      onSave={onSave}
    />,
  );
  fireEvent.click(screen.getByText("Teach Verdict from this scene"));
  return onSave;
}

it("records a positive example on the saved scene revision without promoting a global rule", async () => {
  mockApi.mockResolvedValue({ id: "feedback-1" });
  const onSave = setup();
  fireEvent.click(screen.getByText("Keep"));
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(mockApi).toHaveBeenCalledWith(
    "/creative-dna/feedback",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        project_id: "episode-1",
        base_revision: 7,
        scene_id: "scene-1",
        category: "panel",
        decision: "keep",
        note: "",
      }),
    }),
  );
  expect(
    screen.getByText(/positive example, not a global rule/i),
  ).toBeInTheDocument();
});

it("requires an explanation before recording a change recommendation", async () => {
  mockApi.mockResolvedValue({});
  setup();
  const change = screen.getByText("Fix next time");
  expect(change).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Scene 1 feedback topic"), {
    target: { value: "crop" },
  });
  fireEvent.change(screen.getByLabelText("Scene 1 feedback note"), {
    target: { value: "Do not cut off speech balloons" },
  });
  fireEvent.click(change);
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  expect(JSON.parse(mockApi.mock.calls[0][1].body)).toMatchObject({
    base_revision: 7,
    category: "crop",
    decision: "change",
    note: "Do not cut off speech balloons",
  });
  expect(screen.getByText(/approve a reusable rule/i)).toBeInTheDocument();
});

it("never records feedback on a deleted or unsaved scene", async () => {
  const onSave = vi.fn().mockResolvedValue({ ...saved, scenes: [] });
  setup(onSave);
  fireEvent.click(screen.getByText("Keep"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(mockApi).not.toHaveBeenCalled();
});
