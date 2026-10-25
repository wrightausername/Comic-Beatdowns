import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NewProject } from "./dialogs";
import { api } from "./api";
import { stagedChecks } from "./episodeIntake";
import type { IntakeFile } from "./episodeIntake";
import type { Project, VisionConnection } from "./types";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
const mocked = vi.mocked(api);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => vi.resetAllMocks());
const makeFile = (name: string, type: string) =>
  new File(["original test content"], name, { type, lastModified: 123 });
const art = () => makeFile("original.png", "image/png");
const voice = () => makeFile("voice.wav", "audio/wav");
const blankConnection = {
  configured: false,
  has_key: false,
  authorization_id: null,
  base_url: "",
  model: "",
  transcription_model: "",
};
function fakeBackend(failVoiceOnce = false, configured?: VisionConnection) {
  let project = {
    id: "kept-project",
    title: "Original episode",
    revision: 1,
    scene_count: 0,
    narration_url: null,
    workflow: { panel_ids: [] },
  } as unknown as Project;
  const imports: string[] = [],
    starts: unknown[] = [];
  let failed = false;
  mocked.mockImplementation(async (path, options) => {
    if (path === "/verdict/connection") return configured ?? blankConnection;
    if (path === "/projects") return project;
    if (path.endsWith("/director") && !options?.method) return [];
    if (path.endsWith("/import-file")) {
      const body = options!.body as FormData;
      const file = body.get("file") as File;
      imports.push(file.name);
      if (failVoiceOnce && file.name === "voice.wav" && !failed) {
        failed = true;
        throw new Error("Invalid recording");
      }
      const kind = body.get("kind");
      project = {
        ...project,
        revision: project.revision + 1,
        narration_url:
          kind === "narration" ? "/voice.wav" : project.narration_url,
        workflow: {
          panel_ids:
            kind === "panels"
              ? ["original-panel"]
              : project.workflow!.panel_ids,
        },
      };
      return { project };
    }
    if (path.includes("/intake-readiness?"))
      return {
        ready: true,
        base_revision: project.revision,
        project_id: project.id,
        checks: [
          {
            code: "narration",
            state: "ready",
            message: "Recording validated",
            confirm: false,
          },
        ],
      };
    if (path.endsWith("/autopilot")) {
      const body = JSON.parse(options!.body as string);
      project = { ...project, revision: project.revision + 1, autopilot: body };
      return project;
    }
    if (path.endsWith("/director") && options?.method === "POST") {
      starts.push(JSON.parse(options.body as string));
      return { id: "existing-director-job" };
    }
    if (path === "/projects/kept-project") return project;
    throw new Error(`Unexpected request ${path}`);
  });
  return { imports, starts };
}
function show() {
  const onCreated = vi.fn();
  render(
    <NewProject
      templates={[]}
      initialAutopilot
      onCreated={onCreated}
      onClose={vi.fn()}
      onError={vi.fn()}
    />,
  );
  return onCreated;
}
async function chooseBasic(files = [art(), voice()]) {
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("New project files"), files);
  await user.type(screen.getByLabelText("Project title"), "Original episode");
  await user.click(screen.getByRole("radio", { name: /Basic local/ }));
  await user.click(
    screen.getByLabelText("I am authorized to use this artwork and recording."),
  );
  return user;
}

test("one primary preview action reuses importer, template and director exactly once", async () => {
  const state = fakeBackend();
  const onCreated = show();
  await chooseBasic();
  expect(screen.getByText("Verdict · Auto-Director")).toBeVisible();
  expect(
    screen.getByText(/Basic does not understand comic artwork/),
  ).toBeVisible();
  const form = screen
    .getByRole("button", { name: "Create preview" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(
    mocked.mock.calls.filter(([path]) => path === "/projects"),
  ).toHaveLength(1);
  expect(state.imports).toEqual(["original.png", "voice.wav"]);
  expect(state.starts).toHaveLength(1);
  const optionsCall = mocked.mock.calls.find(([path]) =>
    path.endsWith("/autopilot"),
  )!;
  expect(JSON.parse(optionsCall[1]!.body as string)).toMatchObject({
    enabled: true,
    pace: "fast",
    mode: "basic",
    delivery: "draft",
  });
  expect(mocked.mock.calls.some(([path]) => path.includes("publishing"))).toBe(
    false,
  );
});

test("partial import failure retains the project and skips accepted uploads on retry", async () => {
  const state = fakeBackend(true);
  const onCreated = show();
  const user = await chooseBasic();
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Open saved project in editor" }),
  ).toBeEnabled();
  expect(onCreated).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(
    mocked.mock.calls.filter(([path]) => path === "/projects"),
  ).toHaveLength(1);
  expect(state.imports).toEqual(["original.png", "voice.wav", "voice.wav"]);
  expect(state.starts).toHaveLength(1);
});

test("a script without voice and duplicate voice tracks never start production", async () => {
  fakeBackend();
  show();
  const user = await chooseBasic([
    art(),
    makeFile("reviewed.txt", "text/plain"),
  ]);
  await user.click(
    screen.getByLabelText(
      "I reviewed the script for this recording. Final approval comes after playback.",
    ),
  );
  expect(screen.getByRole("button", { name: "Create preview" })).toBeDisabled();
  await user.upload(screen.getByLabelText("New project files"), [
    voice(),
    makeFile("voice-two.wav", "audio/wav"),
  ]);
  expect(screen.getByRole("button", { name: "Create preview" })).toBeDisabled();
  expect(
    screen.getByText(/Choose exactly one narration recording/),
  ).toBeVisible();
  expect(
    mocked.mock.calls.every(([path]) => path === "/verdict/connection"),
  ).toBe(true);
});

test("Vision cannot upload until the actual saved provider is explicitly authorized", async () => {
  const connection = {
    ...blankConnection,
    configured: true,
    authorization_id: "c".repeat(64),
    base_url: "https://configured.example/v1",
    model: "vision",
  };
  const state = fakeBackend(false, connection);
  const onCreated = show();
  const user = await chooseBasic();
  await user.click(screen.getByRole("radio", { name: /Vision AI/ }));
  expect(screen.getByRole("button", { name: "Create preview" })).toBeDisabled();
  expect(state.imports).toEqual([]);
  await user.click(
    screen.getByRole("checkbox", {
      name: /I authorize sending resized panels/,
    }),
  );
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(state.starts).toEqual([
    { base_revision: 4, vision_connection: "c".repeat(64) },
  ]);
});

test("staging rejects duplicate assets, over-limit uploads, unknown roles and invalid duration", () => {
  const image: IntakeFile = {
    id: "one",
    file: art(),
    kind: "panels",
    status: "pending",
  };
  const narration: IntakeFile = {
    id: "two",
    file: voice(),
    kind: "narration",
    status: "pending",
    duration: 75,
  };
  expect(
    stagedChecks([image, narration]).some(
      (check) => check.state === "blocking",
    ),
  ).toBe(false);
  expect(
    stagedChecks([image, image, narration]).find(
      (check) => check.code === "duplicates",
    )!.state,
  ).toBe("blocking");
  Object.defineProperty(narration.file, "size", { value: 65 * 1024 * 1024 });
  expect(
    stagedChecks([image, narration]).find((check) => check.code === "limits")!
      .state,
  ).toBe("blocking");
  expect(
    stagedChecks([image, { ...narration, duration: 181 }]).find(
      (check) => check.code === "length",
    )!.state,
  ).toBe("blocking");
  expect(
    stagedChecks([
      image,
      narration,
      { ...image, kind: "unknown", id: "other" },
    ]).find((check) => check.code === "roles")!.state,
  ).toBe("blocking");
});

test("unknown or conflicting roles can be corrected in the same screen", async () => {
  fakeBackend();
  show();
  await chooseBasic([art(), voice(), makeFile("music.wav", "audio/wav")]);
  const role = screen.getByLabelText("New project role for music.wav");
  fireEvent.change(role, { target: { value: "narration" } });
  expect(screen.getByRole("button", { name: "Create preview" })).toBeDisabled();
  fireEvent.change(role, { target: { value: "music" } });
  expect(screen.getByRole("button", { name: "Create preview" })).toBeEnabled();
});

test("script/caption differences require review confirmation and reuse imports on retry", async () => {
  const state = fakeBackend();
  const base = mocked.getMockImplementation()!;
  mocked.mockImplementation(async (path, options) => {
    const value = await base(path, options);
    if (path.includes("/intake-readiness?"))
      return {
        ...(value as object),
        checks: [
          {
            code: "script_caption_mismatch",
            state: "notice",
            confirm: true,
            message: "Script and SRT wording differ.",
          },
        ],
      };
    return value;
  });
  const onCreated = show();
  const user = await chooseBasic();
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await screen.findByRole("alert");
  expect(state.starts).toHaveLength(0);
  await user.click(
    screen.getByLabelText(
      "I will check these script/caption differences in the preview.",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(state.imports).toEqual(["original.png", "voice.wav"]);
  expect(state.starts).toHaveLength(1);
});

test("a changed saved Vision provider cannot inherit the intake authorization", async () => {
  const initial = {
    ...blankConnection,
    configured: true,
    authorization_id: "a".repeat(64),
    base_url: "https://first.example/v1",
    model: "vision",
  };
  const replacement = {
    ...initial,
    authorization_id: "b".repeat(64),
    base_url: "https://second.example/v1",
  };
  const state = fakeBackend(false, initial);
  const base = mocked.getMockImplementation()!;
  let reads = 0;
  mocked.mockImplementation(async (path, options) =>
    path === "/verdict/connection"
      ? reads++ === 0
        ? initial
        : replacement
      : base(path, options),
  );
  const onCreated = show();
  const user = await chooseBasic();
  await user.click(screen.getByRole("radio", { name: /Vision AI/ }));
  await user.click(
    screen.getByRole("checkbox", {
      name: /I authorize sending resized panels/,
    }),
  );
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await screen.findByRole("alert");
  expect(state.starts).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Create preview" })).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: /I authorize sending resized panels.*second\.example/,
    }),
  );
  await user.click(screen.getByRole("button", { name: "Create preview" }));
  await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
  expect(state.imports).toEqual(["original.png", "voice.wav"]);
  expect(state.starts).toEqual([
    { base_revision: 4, vision_connection: "b".repeat(64) },
  ]);
});
