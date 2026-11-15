import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import VerdictAutopilot, {
  handToVerdict,
  orderForProduction,
} from "./VerdictAutopilot";
import { api } from "./api";
import type { Project } from "./types";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
const mocked = vi.mocked(api);
const project = {
  id: "test",
  revision: 4,
  scene_count: 0,
  narration_url: "/voice.wav",
  workflow: { panel_ids: ["panel"] },
  autopilot: { enabled: true, mode: "basic", pace: "fast", delivery: "draft" },
} as Project;
afterEach(() => vi.resetAllMocks());
test("handoff waits for panels, voice, and explicit opt-in", async () => {
  mocked.mockResolvedValue({ id: "director" });
  expect(await handToVerdict({ ...project, narration_url: null })).toBeNull();
  expect(
    await handToVerdict({
      ...project,
      autopilot: { ...project.autopilot!, enabled: false },
    }),
  ).toBeNull();
  expect(await handToVerdict({ ...project, workflow: {} })).toBeNull();
  expect(mocked).not.toHaveBeenCalled();
  await handToVerdict(project);
  expect(mocked).toHaveBeenCalledWith(
    "/projects/test/director",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ base_revision: 4 }),
    }),
  );
});
test("the guided GUI exposes Basic, Vision, pacing, and preview-first delivery", async () => {
  mocked.mockImplementation(async (path) =>
    path === "/verdict/connection" ? { configured: false } : [],
  );
  render(
    <VerdictAutopilot
      project={project}
      dirty={false}
      busy={false}
      accept={vi.fn()}
      perform={async (action) => action()}
      onChanged={vi.fn()}
      onReview={vi.fn()}
      onError={vi.fn()}
    />,
  );
  expect(
    screen.getByRole("checkbox", { name: "Verdict Autopilot" }),
  ).toBeChecked();
  expect(screen.getByLabelText("Delivery")).toHaveValue("draft");
  expect(screen.getByLabelText("Pacing")).toHaveValue("fast");
  expect(
    screen.getByText(/Basic cannot inspect the artwork/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Let Verdict handle it" }),
  ).toBeEnabled();
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith("/verdict/connection"),
  );
});
test("an unsaved editor is not replaced by background results", async () => {
  const accept = vi.fn();
  mocked.mockImplementation(async (path) =>
    path === "/verdict/connection"
      ? { configured: false }
      : [
          {
            id: "job",
            status: "working",
            message: "Planning",
            progress: 30,
            output_revision: 5,
            report: {},
            render: null,
          },
        ],
  );
  render(
    <VerdictAutopilot
      project={project}
      dirty
      busy={false}
      accept={accept}
      perform={async (action) => action()}
      onChanged={vi.fn()}
      onReview={vi.fn()}
      onError={vi.fn()}
    />,
  );
  await screen.findByText("Planning");
  expect(accept).not.toHaveBeenCalled();
  expect(mocked).not.toHaveBeenCalledWith("/projects/test");
});
test("preview approval requires the review checkbox and the current saved revision", async () => {
  mocked.mockImplementation(async (path) =>
    path === "/verdict/connection"
      ? { configured: false }
      : [
          {
            id: "job",
            status: "completed",
            message: "Ready",
            progress: 100,
            output_revision: 4,
            report: {},
            render: {
              id: "render",
              status: "completed",
              quality: "draft",
              video_url: "/video.mp4",
              download_url: "/download",
            },
          },
        ],
  );
  render(
    <VerdictAutopilot
      project={project}
      dirty={false}
      busy={false}
      accept={vi.fn()}
      perform={async (action) => action()}
      onChanged={vi.fn()}
      onReview={vi.fn()}
      onError={vi.fn()}
    />,
  );
  const approve = await screen.findByRole("button", {
    name: "Approve & export 1080p",
  });
  expect(approve).toBeDisabled();
  fireEvent.click(
    screen.getByLabelText(
      "I checked the preview, captions, and panel matches.",
    ),
  );
  expect(approve).toBeEnabled();
});

test("batch import keeps SRT after narration and rejects ambiguous voice tracks", () => {
  const captions = { kind: "captions" },
    voice = { kind: "narration" },
    panel = { kind: "panels" };
  expect(orderForProduction([captions, panel, voice])).toEqual([
    panel,
    voice,
    captions,
  ]);
  expect(() => orderForProduction([voice, voice])).toThrow(
    "Choose one narration recording",
  );
});


test("Easy Mode's single Generate click enables safe preview delivery and starts one job", async () => {
  const initial = {
    ...project,
    autopilot: { ...project.autopilot!, enabled: false, delivery: "final" as const },
  };
  const updated = {
    ...initial,
    revision: 5,
    autopilot: { ...initial.autopilot, enabled: true, delivery: "draft" as const },
  };
  mocked.mockImplementation(async (path, init) => {
    if (path === "/verdict/connection") return { configured: false };
    if (path === "/projects/test/director") {
      return init?.method === "POST" ? { id: "new-job", status: "queued", report: {} } : [];
    }
    if (path === "/projects/test/autopilot") return updated;
    if (path === "/projects/test") return initial;
    throw new Error(`Unexpected API call: ${path}`);
  });
  const accept = vi.fn();
  const props = {
    project: initial as Project,
    simple: true,
    dirty: false,
    busy: false,
    accept,
    perform: async (action: () => Promise<void>) => action(),
    onChanged: vi.fn(),
    onReview: vi.fn(),
    onError: vi.fn(),
  };
  const view = render(<VerdictAutopilot {...props} autoRunRequest={0} />);
  view.rerender(<VerdictAutopilot {...props} autoRunRequest={1} />);
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith(
      "/projects/test/autopilot",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          enabled: true,
          mode: "basic",
          pace: "fast",
          delivery: "draft",
          base_revision: 4,
        }),
      }),
    ),
  );
  await waitFor(() =>
    expect(mocked).toHaveBeenCalledWith(
      "/projects/test/director",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ base_revision: 5 }),
      }),
    ),
  );
  view.rerender(<VerdictAutopilot {...props} autoRunRequest={1} />);
  expect(mocked.mock.calls.filter(([path, init]) => path === "/projects/test/director" && init?.method === "POST")).toHaveLength(1);
  expect(accept).toHaveBeenCalledWith(updated);
});
