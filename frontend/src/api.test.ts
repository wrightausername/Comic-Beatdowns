import { afterEach, expect, it, vi } from "vitest";
import { api, json } from "./api";

afterEach(() => vi.unstubAllGlobals());
it("preserves API errors so validation failures remain actionable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: "Narration is longer than the timeline.",
      }),
    }),
  );
  await expect(api("/projects/a/renders", json({}))).rejects.toThrow(
    "Narration is longer than the timeline.",
  );
});
it("does not replace a multipart boundary with a JSON content type", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetcher);
  await api("/panels/import", { method: "POST", body: new FormData() });
  expect(
    (fetcher.mock.calls[0][1].headers as Headers).has("Content-Type"),
  ).toBe(false);
});
it("names invalid nested shots and keeps all server validation requirements", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          {
            loc: ["body", "scenes", 1, "duration"],
            type: "greater_than_equal",
            msg: "Input should be greater than or equal to 0.25",
            input: -1,
          },
          {
            loc: ["body", "title"],
            type: "string_too_long",
            msg: "String should have at most 200 characters",
            input: "private user content",
          },
        ],
      }),
    }),
  );
  await expect(api("/projects/a/workspace", json({}))).rejects.toThrow(
    "Shot 2 → Duration (seconds): Input should be greater than or equal to 0.25\nProject title: String should have at most 200 characters",
  );
});
it("explains missing uploads and valid naming prefixes without echoing private input", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          { loc: ["body", "file"], type: "missing", msg: "Field required" },
          {
            loc: ["body", "prefix"],
            type: "string_pattern_mismatch",
            msg: "String should match pattern",
            input: "private input",
          },
        ],
      }),
    }),
  );
  await expect(
    api("/projects/a/panel-organization/preview", json({})),
  ).rejects.toThrow(
    "File: This is required.\nPanel naming prefix: Use letters, numbers, underscores or hyphens, such as ww_01.",
  );
});
it("identifies request compatibility and revision failures as app issues instead of nonexistent form fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        detail: [
          {
            loc: ["body", "voice_approved"],
            type: "extra_forbidden",
            msg: "Extra inputs are not permitted",
          },
          {
            loc: ["body", "base_revision"],
            type: "missing",
            msg: "Field required",
          },
        ],
      }),
    }),
  );
  await expect(api("/projects/a/autopilot", json({}))).rejects.toThrow(
    "Narration approval: Studio sent a setting this version cannot accept.",
  );
  await expect(api("/projects/a/autopilot", json({}))).rejects.toThrow(
    "Saved project version: Reload this production, then try again. Your files are kept.",
  );
});
it("does not invent field errors when the response body cannot be read", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => {
        throw new Error("not JSON");
      },
    }),
  );
  await expect(api("/projects/a/autopilot", json({}))).rejects.toThrow(
    "returned no field details",
  );
});
