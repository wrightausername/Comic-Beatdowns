import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import useStudioDraft from "./useStudioDraft";
import type { Project } from "./types";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
const base = {
  id: "project-test",
  title: "My project",
  idea: "",
  script: "",
  revision: 1,
  settings: { fps: 24 },
  scenes: [],
  caption_cues: [],
  can_undo: false,
  can_redo: false,
} as unknown as Project;
const changed = vi.fn(),
  failed = vi.fn();
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
  changed.mockClear();
  failed.mockClear();
});
afterEach(() => vi.useRealTimers());
async function open() {
  vi.mocked(api).mockResolvedValueOnce(structuredClone(base));
  const hook = renderHook(() =>
    useStudioDraft(base.id, false, changed, failed),
  );
  await waitFor(() => expect(hook.result.current.draft).not.toBeNull());
  return hook;
}

it("autosaves the latest draft after a short pause", async () => {
  const { result } = await open();
  vi.useFakeTimers();
  vi.mocked(api).mockResolvedValueOnce({
    ...base,
    script: "A saved punchline",
    revision: 2,
  });
  act(() => result.current.update({ script: "A saved punchline" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  const [, request] = vi.mocked(api).mock.calls.at(-1)!;
  expect(JSON.parse(request!.body as string)).toMatchObject({
    base_revision: 1,
    script: "A saved punchline",
  });
  expect(result.current.dirty).toBe(false);
  expect(result.current.status).toBe("All changes saved");
});

it("keeps edits made while a save is in flight and uses the new revision next", async () => {
  const { result } = await open();
  vi.useFakeTimers();
  let finish!: (p: Project) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise<Project>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => result.current.update({ script: "First version" }));
  let saving!: Promise<Project | null>;
  act(() => {
    saving = result.current.flush();
  });
  act(() => result.current.update({ script: "Newest version" }));
  await act(async () => {
    finish({ ...base, script: "First version", revision: 2 });
    await saving;
  });
  expect(result.current.draft?.script).toBe("Newest version");
  expect(result.current.dirty).toBe(true);
  expect(result.current.status).toBe("Unsaved changes");
  vi.mocked(api).mockResolvedValueOnce({
    ...base,
    script: "Newest version",
    revision: 3,
  });
  await act(async () => {
    await result.current.flush();
  });
  expect(
    JSON.parse(vi.mocked(api).mock.calls.at(-1)![1]!.body as string),
  ).toMatchObject({ base_revision: 2, script: "Newest version" });
  expect(result.current.dirty).toBe(false);
});

it("keeps a conflicted browser draft and does not retry overwriting another tab", async () => {
  const { result } = await open();
  vi.useFakeTimers();
  vi.mocked(api).mockRejectedValueOnce(
    new ApiError("Changed in another window", 409),
  );
  act(() => result.current.update({ script: "Keep my local work" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(950);
  });
  expect(result.current.status).toContain("Save failed");
  expect(localStorage.getItem(`comic-beatdowns:draft:${base.id}`)).toContain(
    "Keep my local work",
  );
  act(() => result.current.update({ script: "Still working locally" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(api).toHaveBeenCalledTimes(2);
  expect(result.current.draft?.script).toBe("Still working locally");
});

it("offers crash recovery without replacing a newer saved project automatically", async () => {
  localStorage.setItem(
    `comic-beatdowns:draft:${base.id}`,
    JSON.stringify({
      revision: 1,
      draft: {
        title: "Recovered",
        idea: "",
        script: "Unsaved line",
        settings: base.settings,
        scenes: [],
        cues: [],
      },
    }),
  );
  const { result } = await open();
  expect(result.current.draft?.title).toBe("My project");
  expect(result.current.recovery?.title).toBe("Recovered");
  expect(localStorage.getItem(`comic-beatdowns:draft:${base.id}`)).toContain(
    "Recovered",
  );
  act(() => result.current.recover());
  expect(result.current.draft?.script).toBe("Unsaved line");
  expect(result.current.dirty).toBe(true);
});
