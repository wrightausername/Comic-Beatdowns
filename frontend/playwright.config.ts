import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const data =
  process.env.CB_E2E_DATA_DIR ||
  mkdtempSync(join(tmpdir(), "comic-beatdowns-e2e-"));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    actionTimeout: 15_000,
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CB_BROWSER_PATH || undefined },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command:
        "../.venv/bin/uvicorn app.main:app --app-dir ../backend --host 127.0.0.1 --port 8000",
      url: "http://127.0.0.1:8000/api/health",
      reuseExistingServer: false,
      env: {
        CB_DATA_DIR: data,
        CB_STUDIO_TOKEN: "e2e-only-studio-token-not-a-real-secret",
      },
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
    },
  ],
});
