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
