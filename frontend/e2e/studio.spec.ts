import { expect, test, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function crc32(buffer: Buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
function originalPng() {
  const width = 320,
    height = 480,
    header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = y * (width * 3 + 1) + 1 + x * 3;
      pixels[offset] = x % 100;
      pixels[offset + 1] = 70 + (y % 130);
      pixels[offset + 2] = 120;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function silentWav(seconds = 1) {
  const audio = Buffer.alloc(44 + 16000 * 2 * seconds);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  return audio;
}

async function openTimeline(page: Page) {
  await page
    .getByRole("button", { name: "Open Video timeline", exact: true })
    .click();
  const section = page.locator("details.creator-advanced-timeline");
  await expect(section).toBeVisible();
  if (!(await section.evaluate((el) => el.hasAttribute("open"))))
    await section.locator(":scope > summary").click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("comic-beatdowns:editor-mode", "advanced"),
  );
  await page.goto("/");
  await page
    .getByLabel("Studio access token")
    .fill("e2e-only-studio-token-not-a-real-secret");
  await page.getByRole("button", { name: "Enter the studio" }).click();
  await expect(
    page.getByRole("heading", { name: "The production desk." }),
  ).toBeVisible();
});

test("workspace tools are discoverable, keyboard accessible and usable on mobile", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Find every editing tool");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  const tools = page.getByRole("region", { name: "Workspace tools" });
  await expect(tools).toBeVisible();
  await page.getByRole("button", { name: "Return to Easy Mode" }).click();
  await expect(tools.getByRole("button", { name: /^Open / })).toHaveCount(6);
  await expect(
    tools.getByRole("button", { name: "Open Review & export" }),
  ).toBeDisabled();
  await expect(
    tools.getByText(/Add or generate shots to unlock editing and export/),
  ).toBeVisible();
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Find every editing tool",
  ).id;
  const initial = await (await page.request.get(`/api/projects/${id}`)).json();
  await tools.screenshot({
    path: testInfo.outputPath("workspace-tools-desktop.png"),
  });
  await tools.getByRole("button", { name: "Open Reference style" }).focus();
  await page.keyboard.press("Enter");
  const reference = page.locator("#studio-reference-style");
  await expect(reference.getByLabel("Reference video file")).toBeVisible();
  await expect(reference.locator(":scope > summary")).toBeFocused();
  await tools
    .getByRole("button", { name: "Open AI editing assistant" })
    .click();
  await expect(page.getByLabel("Paste an editing instruction")).toBeVisible();
  await expect(
    page.locator("#studio-editing-instructions > summary"),
  ).toBeFocused();
  await tools.getByRole("button", { name: "Open Video timeline" }).click();
  await expect(
    page.getByRole("region", { name: "Video edit timeline", exact: true }),
  ).toBeVisible();
  await tools.getByRole("button", { name: "Saved defaults" }).click();
  await expect(page.getByLabel("Preferred recipe name")).toBeVisible();
  await tools
    .getByRole("button", { name: "Review queue", exact: true })
    .click();
  await expect(page.locator("#studio-review-queue > summary")).toBeFocused();
  await tools.getByRole("button", { name: "Open Make a draft" }).click();
  await expect(
    page.getByRole("heading", { name: "Make your video draft" }),
  ).toBeFocused();
  await tools.getByRole("button", { name: "Open Add files" }).click();
  await expect(
    page.getByRole("heading", { name: "1. Add your files" }),
  ).toBeFocused();
  expect(await (await page.request.get(`/api/projects/${id}`)).json()).toEqual(
    initial,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await tools.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBeTruthy();
  await tools.screenshot({
    path: testInfo.outputPath("workspace-tools-mobile.png"),
  });
  await tools.getByRole("button", { name: "Open Reference style" }).click();
  await expect(reference.getByLabel("Reference video file")).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Return to Easy Mode" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("import, crop, sequence, approve, upload narration, render, and download", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "Panel library", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Import panels", exact: true })
    .click();
  await page.getByLabel("Source files").setInputFiles({
    name: "original-test.png",
    mimeType: "image/png",
    buffer: originalPng(),
  });
  await page.getByLabel("Panel title").fill("Original test panel");
  await page.getByLabel("Comic series").fill("Original test series");
  await page.getByLabel("Characters", { exact: true }).fill("Azure and Slate");
  await page.getByRole("button", { name: "Import to library" }).click();
  await page
    .getByRole("heading", { name: "Original test panel", exact: true })
    .click();
  const stage = await page.locator(".crop-stage").boundingBox();
  expect(stage).toBeTruthy();
  await page.mouse.move(stage!.x + 15, stage!.y + 15);
  await page.mouse.down();
  await page.mouse.move(
    stage!.x + stage!.width * 0.8,
    stage!.y + stage!.height * 0.8,
  );
  await page.mouse.up();
  await page.getByLabel("Resize crop to width (px)").fill("240");
  await page.getByRole("button", { name: "Save as new panel" }).click();
  await expect(page.locator(".panel-card")).toHaveCount(2);
  await page.getByLabel("Search panel library").fill("Azure");
  await expect(page.locator(".panel-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Production desk", exact: true })
    .click();
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill("An original browser beatdown");
  await page
    .getByLabel("The angle", { exact: true })
    .fill("A bad decision deserves a great punchline.");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { name: "An original browser beatdown" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: "Add panels", exact: true }).click();
  await page.locator(".picker-card").first().click();
  await page.locator(".picker-card").last().click();
  await page.getByRole("button", { name: "Add 2 panels" }).click();
  await page.getByLabel("Scene 1 duration").fill("0.75");
  await page.getByLabel("Scene 2 duration").fill("0.75");
  await page
    .getByLabel("Scene 1 caption")
    .fill("That defense just left the chat.");
  await page.getByRole("button", { name: "Move scene 2 up" }).click();
  await page
    .getByRole("button", { name: "Subtle push", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Scene 1 motion", { exact: true })
    .selectOption("drift_up_right");
  await page
    .getByLabel("Scene 2 transition", { exact: true })
    .selectOption("smooth_left");
  await page.getByLabel("Scene 2 transition duration").fill("0.2");
  await page.locator(".camera-details summary").first().click();
  await page
    .getByLabel("Scene 1 easing", { exact: true })
    .selectOption("ease_out");
  await page.getByLabel("Scene 1 horizontal framing").focus();
  await page.getByLabel("Scene 1 horizontal framing").press("ArrowRight");
  await page
    .getByRole("button", { name: "Preview scene", exact: true })
    .first()
    .click();

  await page.getByRole("button", { name: "Save timeline" }).click();
  await expect(
    page.getByText("Timeline saved.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Production desk", exact: true })
    .click();
  await page
    .locator(".project-card")
    .filter({ hasText: "An original browser beatdown" })
    .click();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "drift_up_right",
  );
  await expect(
    page.getByLabel("Scene 2 transition", { exact: true }),
  ).toHaveValue("smooth_left");
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("camera-editor.png"),
    fullPage: true,
  });
  await page.getByLabel("Add ElevenLabs narration (MP3/WAV)").setInputFiles({
    name: "original-silence.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect(
    page.getByText("Narration uploaded and normalized."),
  ).toBeVisible();
  // Cancelling replacement must retain the original recording without an upload.
  let replacementUploads = 0;
  const countReplacement = (request: import("@playwright/test").Request) => {
    if (request.method() === "POST" && request.url().endsWith("/narration"))
      replacementUploads += 1;
  };
  page.on("request", countReplacement);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("cuts and captions may need retiming");
    await dialog.dismiss();
  });
  await page.getByLabel("Add ElevenLabs narration (MP3/WAV)").setInputFiles({
    name: "cancelled-replacement.wav",
    mimeType: "audio/wav",
    buffer: silentWav(3),
  });
  expect(replacementUploads).toBe(0);
  page.off("request", countReplacement);
  await page
    .getByRole("button", { name: "Verdict script", exact: true })
    .click();
  await page
    .getByLabel("Verdict’s script", { exact: true })
    .fill(
      "That defense just left the chat. And the offense forgot the password. Which brings us right back to that defense.",
    );
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Approve script" }).click();
  await expect(page.getByRole("button", { name: "Render MP4" })).toBeEnabled();
  await page.getByRole("button", { name: "Render MP4" }).click();
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  await expect(page.locator(".export-card .mini-tag").first()).toHaveText(
    "COMPLETED",
    { timeout: 60_000 },
  );
  await expect(page.locator(".export-card video")).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download MP4" }).click();
  const download = await downloadEvent;
  const output = testInfo.outputPath("export.mp4");
  await download.saveAs(output);
  const content = await readFile(output);
  expect(content.subarray(4, 8).toString()).toBe("ftyp");
  await page
    .getByRole("button", { name: "Production desk", exact: true })
    .click();
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("production-desk.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("mobile navigation remains usable without horizontal overflow", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Panel library", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Every panel. Every punch." }),
  ).toBeVisible();
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflows).toBe(false);
  await page
    .getByRole("button", { name: "Production desk", exact: true })
    .click();
  await page.locator(".project-card").first().click();
  const fullEditor = page.getByRole("button", { name: "Open full editor" });
  const timelineTab = page.getByRole("button", {
    name: "Timeline",
    exact: true,
  });
  await expect(fullEditor.or(timelineTab)).toBeVisible();
  if (await fullEditor.isVisible()) await fullEditor.click();
  await timelineTab.click();
  await page.locator(".camera-details summary").first().click();
  await expect(
    page.getByLabel("Scene 1 easing", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("mobile-production.png"),
    fullPage: true,
  });
});

test("autosave, fast and slow cuts, bulk undo, waveform timing, captions, brand kit, and draft export", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const saved = () =>
    expect(page.getByLabel("Autosave status")).toHaveText("All changes saved");
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project title").fill("Effortless editing");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: "Add panels", exact: true }).click();
  await page.locator(".picker-card").first().click();
  await page.locator(".picker-card").last().click();
  await page.getByRole("button", { name: "Add 2 panels" }).click();
  await page.getByLabel("Add ElevenLabs narration (MP3/WAV)").setInputFiles({
    name: "six-seconds.wav",
    mimeType: "audio/wav",
    buffer: silentWav(6),
  });
  await expect(
    page.getByText("Narration uploaded and normalized."),
  ).toBeVisible();
  await page
    .getByText("Auto Edit · pacing and excerpt options", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Fast · punchy", exact: false })
    .click();
  await page.getByRole("button", { name: "Create first cut" }).click();
  await expect(
    page.getByText("Fast first cut created:", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".scene-card")).toHaveCount(5);
  await saved();
  await page.reload();
  // The app's navigation is local; reopen the project after reloading.
  await page
    .locator(".project-card")
    .filter({ hasText: "Effortless editing" })
    .click();
  await expect(page.locator(".scene-card")).toHaveCount(5);
  await page.getByLabel("Select all scenes", { exact: true }).check();
  await page.getByLabel("Bulk camera motion").selectOption("pan_up");
  await page.getByLabel("Bulk movement strength").fill("20");
  await page.getByRole("button", { name: "Apply to selected" }).click();
  await saved();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "pan_up",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "punch_in",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).first().click();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "pan_up",
  );
  await page
    .getByRole("button", { name: "Slow · smooth", exact: false })
    .click();
  await page.getByLabel("Auto Edit length").selectOption("short");
  await page.getByRole("button", { name: "Create first cut" }).click();
  await expect(
    page.getByText("Slow first cut created:", { exact: false }),
  ).toBeVisible();
  await expect(page.locator(".scene-card")).toHaveCount(2);
  await saved();
  await page
    .getByText("Precise narration cuts · speech and pause snapping", {
      exact: true,
    })
    .click();
  const cut = page.getByRole("slider", { name: "Cut after scene 1" });
  const before = Number(await cut.getAttribute("aria-valuenow"));
  await cut.focus();
  await cut.press("ArrowRight");
  await expect
    .poll(async () => Number(await cut.getAttribute("aria-valuenow")))
    .toBeGreaterThan(before);
  await saved();
  const handle = await cut.boundingBox();
  expect(handle).toBeTruthy();
  const durationBeforeDrag = Number(
    await page.getByLabel("Scene 1 duration", { exact: true }).inputValue(),
  );
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 40);
  await page.mouse.down();
  await page.mouse.move(handle!.x + handle!.width / 2 + 25, handle!.y + 40, {
    steps: 4,
  });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(
        await page.getByLabel("Scene 1 duration", { exact: true }).inputValue(),
      ),
    )
    .toBeGreaterThan(durationBeforeDrag);
  const durations = await page
    .locator('.scene-body input[type="number"]')
    .evaluateAll((inputs) =>
      inputs.map((input) => Number((input as HTMLInputElement).value)),
    );
  expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(6, 4);
  await saved();
  await page
    .getByRole("button", { name: "Generate captions", exact: true })
    .click();
  await expect(
    page.getByText("No speech was recognized.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Import SRT captions").setInputFiles({
    name: "verdict.srt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      "1\n00:00:00,000 --> 00:00:01,000\nVerdict hits hard\n",
    ),
  });
  await expect(page.getByLabel("Caption 1 text")).toHaveValue(
    "Verdict hits hard",
  );
  await page.getByLabel("Caption 1 text").fill("VERDICT hits hard");
  await saved();
  const srtDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download SRT", exact: true }).click();
  const srtFile = await srtDownload;
  const srtTarget = testInfo.outputPath("captions.srt");
  await srtFile.saveAs(srtTarget);
  expect(await readFile(srtTarget, "utf8")).toContain("VERDICT hits hard");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Caption style", { exact: true })
    .selectOption("punchy");
  await page.getByLabel("Upload brand logo").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: originalPng(),
  });
  await expect(page.getByText("Logo saved.", { exact: true })).toBeVisible();
  await page.getByLabel("Upload background music").setInputFiles({
    name: "music.wav",
    mimeType: "audio/wav",
    buffer: silentWav(1),
  });
  await expect(page.getByText("Music saved.", { exact: true })).toBeVisible();
  await page.getByLabel("Template name").fill("Verdict brand kit");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(
    page.getByText("Brand template saved.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("streamlined-editor.png"),
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: "Render MP4", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Draft preview", exact: true })
    .click();
  await expect(page.locator(".render-row").first()).toContainText("completed", {
    timeout: 60_000,
  });
  await expect(page.locator(".render-row").first()).toContainText(
    "Draft · 360p",
  );
  const download = page.waitForEvent("download");
  await page
    .locator(".render-row")
    .first()
    .getByRole("link", { name: "MP4", exact: true })
    .click();
  const file = await download;
  const target = testInfo.outputPath("draft.mp4");
  await file.saveAs(target);
  expect((await readFile(target)).subarray(4, 8).toString()).toBe("ftyp");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("streamlined-mobile.png"),
    fullPage: true,
  });
});

test("guided draft builder, storyboard, locked shots, versions, review notes, and section export", async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "Azure punch.png", mimeType: "image/png", buffer: originalPng() },
    { name: "Slate reveal.png", mimeType: "image/png", buffer: originalPng() },
    { name: "narration.wav", mimeType: "audio/wav", buffer: silentWav(6) },
    {
      name: "captions.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:03,000\nAzure punches hard!\n\n2\n00:00:03,000 --> 00:00:06,000\nSlate reveals a surprise!\n",
      ),
    },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Guided automation");
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "1. Add your files" }),
  ).toBeVisible();
  await expect(page.locator(".tray-panel")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Verdict script", exact: true })
    .click();
  await page
    .getByLabel("Verdict’s script", { exact: true })
    .fill("Azure punches hard! Slate reveals a surprise!");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await page.locator(".workflow-steps button").nth(1).click();
  await page
    .getByRole("button", { name: "Suggest panel matches", exact: true })
    .click();
  await expect(page.locator(".storyboard-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Use these assignments", exact: true })
    .click();
  await expect(page.getByLabel("Autosave status")).toHaveText(
    "All changes saved",
  );
  await page.locator(".workflow-steps button").nth(2).click();
  await page
    .getByRole("button", { name: "Build My Draft", exact: true })
    .click();
  await expect(page.locator(".suggestion-row")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Preview proposed draft", exact: true })
    .click();
  await expect(
    page.getByText("Previewing proposed / saved edit"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Accept selected suggestions", exact: true })
    .click();
  await expect(page.locator(".scene-card")).toHaveCount(5);
  await expect(page.getByLabel("Autosave status")).toHaveText(
    "All changes saved",
  );
  await page.getByRole("button", { name: "Lock scene 1", exact: true }).click();
  await expect(
    page
      .locator(".scene-card")
      .first()
      .getByRole("button", { name: "Split", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Unlock scene 1", exact: true })
    .click();
  await page
    .locator(".scene-card")
    .first()
    .getByRole("button", { name: "Read Panel", exact: true })
    .click();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "hold",
  );
  await page.getByRole("button", { name: "Safe areas", exact: true }).click();
  await expect(page.getByLabel("Approximate Shorts safe areas")).toBeVisible();
  await page.getByRole("button", { name: "Check Loop", exact: true }).click();
  await expect(
    page.getByText("Repeating the final 3 seconds", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check Loop", exact: true }).click();
  await page.locator(".workflow-steps button").nth(3).click();
  await page.getByLabel("Version name", { exact: true }).fill("Edit A");
  await page
    .getByRole("button", { name: "Save named version", exact: true })
    .click();
  await expect(page.locator(".version-list")).toContainText("Edit A");
  await page.getByLabel("Note time", { exact: true }).fill("2");
  await page
    .getByLabel("Review note", { exact: true })
    .fill("Check the impact framing");
  await page.getByRole("button", { name: "Add note", exact: true }).click();
  await expect(
    page.getByLabel("Resolve note Check the impact framing"),
  ).toBeVisible();
  await page.getByLabel("Resolve note Check the impact framing").check();
  await expect(page.getByLabel("Autosave status")).toHaveText(
    "All changes saved",
  );
  await page.locator(".workflow-steps button").nth(4).click();
  await page.getByText("Preview only a section", { exact: true }).click();
  await page.getByLabel("Section start", { exact: true }).fill("1");
  await page.getByLabel("Section end", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Render selected section", exact: true })
    .click();
  await expect(page.locator(".render-row").first()).toContainText("completed", {
    timeout: 60_000,
  });
  await expect(page.locator(".review-video").first()).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page
    .locator(".render-row")
    .first()
    .getByRole("link", { name: "MP4", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/Guided_automation_Section_v/);
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("guided-export.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    timeout: 60_000,
    path: testInfo.outputPath("guided-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Verdict Autopilot turns uploaded panels and voice into a preview and approved final", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await expect(
    page.getByLabel("Let Verdict handle the edit after upload"),
  ).toBeChecked();
  await page.getByLabel("New project files").setInputFiles([
    {
      name: "original-autopilot.png",
      mimeType: "image/png",
      buffer: originalPng(),
    },
    { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav(2) },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Verdict upload handoff");
  await page.getByRole("button", { name: /Create project/ }).click();
  const card = page.getByRole("region", {
    name: "Verdict Autopilot",
    exact: true,
  });
  await expect(card).toBeVisible();
  const approve = card.getByRole("button", { name: "Approve & export 1080p" });
  await expect(approve).toBeVisible({ timeout: 120_000 });
  await expect(card.getByLabel("Verdict rendered video")).toHaveAttribute(
    "src",
    /\.mp4$/,
  );
  await expect(approve).toBeDisabled();
  await expect(card.getByText(/No timed speech found/)).toBeVisible();
  await openTimeline(page);
  const timeline = page.getByRole("region", { name: "Video edit timeline" });
  await expect(timeline).toBeVisible();
  await expect(
    timeline.getByRole("button", { name: /Timeline shot 1:/ }),
  ).toBeVisible();
  await expect(
    timeline.getByLabel("Narration track", { exact: true }),
  ).toContainText("imported recording");
  await timeline.screenshot({
    path: testInfo.outputPath("ai-video-timeline.png"),
  });

  await page.screenshot({
    path: testInfo.outputPath("verdict-autopilot.png"),
    timeout: 60_000,
  });
  await page
    .getByRole("button", { name: "Open Make a draft", exact: true })
    .click();
  await card
    .getByLabel("I checked the preview, captions, and panel matches.")
    .check();
  await approve.click();
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const download = page
    .locator(".export-card")
    .filter({ hasText: "Final · 1080p" })
    .filter({ hasText: "Verdict upload handoff" })
    .getByRole("link", { name: "Download MP4" });
  await expect(download).toBeVisible({ timeout: 120_000 });
  const fileEvent = page.waitForEvent("download");
  await download.click();
  const file = await fileEvent;
  expect(file.suggestedFilename()).toContain("Verdict_upload_handoff_Final");
  expect(errors).toEqual([]);
});

test("Easy Mode walks a first-time creator through missing inputs without pretending to generate voice", async ({
  page,
}) => {
  await page.evaluate(() =>
    localStorage.removeItem("comic-beatdowns:editor-mode"),
  );
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("The angle", { exact: true })
    .fill("Why this supposedly unbeatable hero gets flattened.");
  await page.getByRole("button", { name: "Create project" }).click();
  const guide = page.getByRole("region", { name: "Easy video creation" });
  await expect(guide).toBeVisible();
  await expect(
    guide.getByText("Start by adding your comic panels"),
  ).toBeVisible();
  await expect(guide.getByText(/needs a recorded voice track/i)).toHaveCount(0);
  await guide.getByRole("button", { name: "Add missing files" }).click();
  await expect(page.getByText("Drop project files here")).toBeVisible();
  const autopilot = page.getByRole("region", { name: "Verdict Autopilot" });
  await page.getByRole("button", { name: "Open Make a draft" }).click();
  await expect(
    autopilot.getByRole("button", { name: "Make my video draft" }),
  ).toBeDisabled();
  await guide.getByRole("button", { name: "Open full editor" }).click();
  await expect(
    page.getByRole("button", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Return to Easy Mode" }).click();
  await expect(guide).toBeVisible();
});

test("AI timeline edits persist after reload", async ({ page }) => {
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "timeline-art.png", mimeType: "image/png", buffer: originalPng() },
    { name: "timeline-voice.wav", mimeType: "audio/wav", buffer: silentWav(4) },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Editable AI timeline");
  await page.getByRole("button", { name: /Create project/ }).click();
  const card = page.getByRole("region", {
    name: "Verdict Autopilot",
    exact: true,
  });
  await expect(
    card.getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  await openTimeline(page);
  const timeline = page.getByRole("region", { name: "Video edit timeline" });
  await timeline.getByRole("button", { name: /Timeline shot 1:/ }).click();
  await timeline
    .getByLabel("Timeline shot camera")
    .selectOption("impact_shake");
  await expect(page.getByLabel("Autosave status")).toHaveText(
    "All changes saved",
  );
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Editable AI timeline" })
    .click();
  await openTimeline(page);
  await expect(timeline.getByLabel("Timeline shot camera")).toHaveValue(
    "impact_shake",
  );
  const count = await timeline
    .getByRole("button", { name: /Timeline shot/ })
    .count();
  await timeline.getByLabel("Video timeline playhead").fill("0.375");
  await timeline
    .getByRole("button", { name: "Split shot at playhead" })
    .click();
  await expect(page.getByLabel("Autosave status")).toHaveText(
    "All changes saved",
  );
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Editable AI timeline" })
    .click();
  await openTimeline(page);
  await expect(
    timeline.getByRole("button", { name: /Timeline shot/ }),
  ).toHaveCount(count + 1);
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Editable AI timeline",
  ).id;
  const saved = await (await page.request.get(`/api/projects/${id}`)).json();
  expect(saved.scenes[0].motion).toBe("impact_shake");
  expect(saved.scenes).toHaveLength(count + 1);
  const response = await page.request.post(`/api/projects/${id}/renders`, {
    data: { quality: "draft" },
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/renders/${job.id}`)).json())
          .status,
      { timeout: 120_000 },
    )
    .toBe("completed");
  const rendered = await (
    await page.request.get(`/api/renders/${job.id}`)
  ).json();
  expect(rendered.project_revision).toBe(saved.revision);
  expect((await page.request.get(rendered.download_url)).status()).toBe(200);
});

test("direct timeline dragging, trim handles, playback, caption editing and mixer persist", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    ...["first", "second", "third"].map((name) => ({
      name: `${name}-timeline.png`,
      mimeType: "image/png",
      buffer: originalPng(),
    })),
    { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav(6) },
    { name: "music-bed.wav", mimeType: "audio/wav", buffer: silentWav(2) },
    {
      name: "captions.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:02,000\nFirst original beat.\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond original beat.\n\n3\n00:00:04,000 --> 00:00:06,000\nThird original beat.\n",
      ),
    },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Direct timeline editing");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Verdict Autopilot", exact: true })
      .getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  await openTimeline(page);
  const timeline = page.getByRole("region", { name: "Video edit timeline" });
  const saved = () =>
    expect(page.getByLabel("Autosave status")).toHaveText("All changes saved");
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Direct timeline editing",
  ).id;
  const read = async () =>
    (await page.request.get(`/api/projects/${id}`)).json();
  await timeline.getByRole("button", { name: "Play timeline" }).click();
  await expect(
    timeline.getByRole("button", { name: "Pause timeline" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      Number(await timeline.getByLabel("Video timeline playhead").inputValue()),
    )
    .toBeGreaterThan(0);
  await timeline.getByRole("button", { name: "Pause timeline" }).click();
  await timeline.getByRole("button", { name: "Snap on", exact: true }).click();
  // Director readiness can precede the render-history poll by one interval.
  // Wait for actual native dragging to be enabled before exercising the gesture.
  await expect(timeline.locator(".video-clip").first()).toHaveAttribute(
    "draggable",
    "true",
  );
  const before = await read();
  await timeline
    .locator(".video-clip")
    .nth(0)
    .dragTo(timeline.locator(".video-clip").nth(2));
  await saved();
  const reordered = await read();
  expect(reordered.scenes.slice(0, 3).map((s: { id: string }) => s.id)).toEqual(
    [before.scenes[1].id, before.scenes[2].id, before.scenes[0].id],
  );
  const handle = timeline.getByRole("slider", {
    name: "Trim right edge of shot 1",
  });
  const rect = await handle.boundingBox();
  expect(rect).toBeTruthy();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect!.x + rect!.width / 2 + 25,
    rect!.y + rect!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await saved();
  const trimmed = await read();
  expect(trimmed.scenes[0].duration).toBeGreaterThan(
    reordered.scenes[0].duration,
  );
  const seconds = (p: { scenes: { duration: number }[] }) =>
    p.scenes.reduce((n, s) => n + s.duration, 0);
  expect(seconds(trimmed)).toBeCloseTo(seconds(reordered), 4);
  // The timeline's own controls and shortcut use durable workspace history.
  const length = trimmed.scenes.length;
  await timeline.press("d");
  await saved();
  await expect.poll(async () => (await read()).scenes.length).toBe(length + 1);
  await timeline
    .getByRole("toolbar", { name: "Timeline editing tools" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect.poll(async () => (await read()).scenes.length).toBe(length);
  await timeline
    .getByRole("toolbar", { name: "Timeline editing tools" })
    .getByRole("button", { name: "Redo", exact: true })
    .click();
  await expect.poll(async () => (await read()).scenes.length).toBe(length + 1);
  await timeline
    .getByRole("toolbar", { name: "Timeline editing tools" })
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect.poll(async () => (await read()).scenes.length).toBe(length);

  await timeline.getByRole("tab", { name: "Caption editor" }).click();
  await timeline
    .getByLabel("Timeline caption words")
    .fill("Owner revised this beat.");
  await saved();
  await timeline.getByRole("tab", { name: "Audio mixer" }).click();
  await timeline.getByLabel("Timeline narration volume").fill("0.4");
  await timeline.getByLabel("Timeline music volume").fill("0.2");
  await saved();
  await expect
    .poll(() =>
      page
        .locator('.editor-preview audio[preload="metadata"]')
        .evaluate((el: HTMLAudioElement) => el.volume),
    )
    .toBeCloseTo(0.4, 2);
  const final = await read();
  expect(final.caption_cues[0].text).toBe("Owner revised this beat.");
  expect(final.settings.music_volume).toBe(0.2);
  await timeline.getByRole("tab", { name: "Shot controls" }).click();
  await timeline.screenshot({
    path: testInfo.outputPath("direct-timeline.png"),
  });
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Direct timeline editing" })
    .click();
  await openTimeline(page);
  await timeline.getByRole("tab", { name: "Caption editor" }).click();
  await expect(timeline.getByLabel("Timeline caption words")).toHaveValue(
    "Owner revised this beat.",
  );
  const response = await page.request.post(`/api/projects/${id}/renders`, {
    data: { quality: "draft" },
  });
  expect(response.status()).toBe(202);
  const job = await response.json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/renders/${job.id}`)).json())
          .status,
      { timeout: 120_000 },
    )
    .toBe("completed");
});

test("episode folder queues pages in order and imports script and voice", async ({
  page,
}, testInfo) => {
  const folder = testInfo.outputPath("Episode intake");
  await mkdir(folder, { recursive: true });
  await Promise.all([
    writeFile(join(folder, "page-10.png"), originalPng()),
    writeFile(join(folder, "page-2.png"), originalPng()),
    writeFile(join(folder, "episode.md"), "Verdict explains the first punch."),
    writeFile(join(folder, "voice.wav"), silentWav(2)),
    writeFile(join(folder, "unrelated.json"), "{}"),
  ]);
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const chooser = page.getByLabel("Episode folder", { exact: true });
  await chooser.setInputFiles(folder);
  await chooser.setInputFiles(folder);
  await expect(page.getByLabel("Project title", { exact: true })).toHaveValue(
    "Episode intake",
  );
  await expect(page.getByLabel("New project role for voice.wav")).toHaveValue(
    "narration",
  );
  await expect(
    page.getByLabel("New project role for unrelated.json"),
  ).toHaveValue("skip");
  const pages = page.getByRole("combobox", {
    name: /New project role for page/,
  });
  await expect(pages).toHaveCount(2);
  await expect(pages.first()).toHaveAccessibleName(
    "New project role for page-2.png",
  );

  const imported: { status: number; body: Record<string, unknown> }[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith("/import-file")) {
      imported.push({ status: response.status(), body: await response.json() });
    }
  });
  await page.getByRole("button", { name: "Create project" }).click();
  await expect
    .poll(() => imported.map((item) => item.status))
    .toEqual([201, 201, 201, 201]);
  const { project } = imported.find(
    (item) => item.body.message === "Added narration",
  )!.body as {
    project: {
      script: string;
      workflow: { panel_ids: string[] };
      narration_url: string;
    };
  };
  expect(project.script).toBe("Verdict explains the first punch.");
  expect(project.workflow.panel_ids).toHaveLength(2);
  expect(project.narration_url).toBeTruthy();
});

test("dropping an episode folder reads all batches and nested files", async ({
  page,
}) => {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  const dropzone = page.locator(".project-dropzone");
  await dropzone.evaluate((element) => {
    const fileEntry = (fullPath: string) => ({
      isFile: true,
      fullPath,
      file: (done: (file: File) => void) =>
        done(new File(["image fixture"], fullPath.split("/").at(-1)!)),
    });
    const directory = (batches: object[][]) => ({
      isDirectory: true,
      createReader: () => ({
        readEntries: (done: (entries: object[]) => void) =>
          done(batches.shift() ?? []),
      }),
    });
    const root = directory([
      [directory([[fileEntry("/Dropped episode/Pages/page-10.png")]])],
      [directory([[fileEntry("/Dropped episode/Pages/page-2.png")]])],
    ]);
    const dataTransfer = new DataTransfer();
    Object.defineProperty(dataTransfer, "items", {
      value: [{ webkitGetAsEntry: () => root }],
    });
    element.dispatchEvent(
      new DragEvent("drop", { bubbles: true, dataTransfer }),
    );
  });
  const pages = page.getByRole("combobox", {
    name: /New project role for page/,
  });
  await expect(pages).toHaveCount(2);
  await expect(pages.first()).toHaveAccessibleName(
    "New project role for page-2.png",
  );
  await expect(page.getByLabel("Project title", { exact: true })).toHaveValue(
    "Dropped episode",
  );
  await expect(page.getByText(/Add an ElevenLabs MP3 or WAV/)).toBeVisible();
});

test("pasted AI editing plan previews, applies, undoes and seeds the preferred recipe", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "assistant-art.png", mimeType: "image/png", buffer: originalPng() },
    { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav(4) },
    {
      name: "words.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:02,000\nOriginal subtitle.\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond subtitle.\n",
      ),
    },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Assistant proposal workflow");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Verdict Autopilot", exact: true })
      .getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  const box = page.getByRole("region", { name: "Creator editing assistant" });
  await page
    .getByRole("button", { name: "Open AI editing assistant", exact: true })
    .click();
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Assistant proposal workflow",
  ).id;
  const read = async () =>
    (await page.request.get(`/api/projects/${id}`)).json();
  const before = await read();
  const plan = {
    version: 1,
    project_id: id,
    base_revision: before.revision,
    caption_edits: [
      { index: 0, changes: { text: "Owner corrected subtitle." } },
    ],
    edits: [
      {
        scene_id: before.scenes[0].id,
        changes: { framing: "fit", motion: "hold", camera_path: null },
      },
    ],
  };
  const workspaceTools = page.getByRole("region", { name: "Workspace tools" });
  await workspaceTools.getByRole("button", { name: "Camera & crops" }).click();
  await expect(
    page.getByRole("heading", { name: "Review your video, shot by shot" }),
  ).toBeFocused();
  await workspaceTools
    .getByRole("button", { name: "Open Review & export" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ready to export?" }),
  ).toBeFocused();
  expect(await read()).toEqual(before);
  await workspaceTools
    .getByRole("button", { name: "Open AI editing assistant" })
    .click();
  await box
    .getByLabel("Paste an editing instruction")
    .fill(
      "ChatGPT suggested this:\n```json\n" + JSON.stringify(plan) + "\n```",
    );
  await box
    .getByRole("button", { name: "Preview proposed changes", exact: true })
    .click();
  const proposed = box.getByLabel("Proposed editing changes");
  await expect(
    proposed.getByRole("button", { name: "Apply reviewed changes" }),
  ).toBeVisible();
  expect((await read()).revision).toBe(before.revision);
  await proposed.getByRole("button", { name: "Watch proposed edit" }).click();
  await expect(
    page.getByText("Previewing proposed / saved edit", { exact: false }),
  ).toBeVisible();
  expect((await read()).revision).toBe(before.revision);
  await proposed
    .getByRole("button", { name: "Apply reviewed changes" })
    .click();
  await expect(box.getByText("Changes applied", { exact: true })).toBeVisible();
  const edited = await read();
  expect(edited.scenes[0].framing).toBe("fit");
  expect(edited.caption_cues[0].text).toBe("Owner corrected subtitle.");
  expect(edited.narration_url).toBe(before.narration_url);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect
    .poll(async () => (await read()).scenes[0].framing)
    .toBe(before.scenes[0].framing);
  await workspaceTools
    .getByRole("button", { name: "Saved defaults", exact: true })
    .click();
  await box.getByLabel("Preferred recipe name").fill("Creator workflow recipe");
  await box
    .getByRole("button", { name: "Use this video as my preferred recipe" })
    .click();
  await expect(box.getByText(/Preferred recipe saved/)).toBeVisible();
  const prefs = await (
    await page.request.get("/api/creator-preferences")
  ).json();
  expect(prefs.template_id).toBeTruthy();
  const created = await (
    await page.request.post("/api/projects", {
      data: { title: "Recipe inherits automatically" },
    })
  ).json();
  expect(created.settings.caption_style).toBe(
    (await read()).settings.caption_style,
  );
  await box.screenshot({ path: testInfo.outputPath("pasted-edit-plan.png") });
  await page.request.put("/api/creator-preferences", {
    data: { template_id: null, observe_edits: true },
  });
});

test("check and export scans the current render and requires creator approval", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "finish-art.png", mimeType: "image/png", buffer: originalPng() },
    { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav(2) },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Check and export workflow");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Verdict Autopilot", exact: true })
      .getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  const project = (await (await page.request.get("/api/projects")).json()).find(
    (p: { title: string }) => p.title === "Check and export workflow",
  );
  const read = async () =>
    (await page.request.get(`/api/projects/${project.id}`)).json();
  const before = await read();
  expect(before.script_approved).toBe(false);
  await page
    .getByRole("button", { name: "Open Review & export", exact: true })
    .click();
  const finish = page.getByRole("region", {
    name: "Finish video",
    exact: true,
  });
  await finish
    .getByRole("button", { name: "Check and export", exact: true })
    .click();
  await expect(
    finish
      .getByText("The mix is nearly silent", { exact: false })
      .or(finish.getByText("Nearly silent mix", { exact: false })),
  ).toBeVisible();
  const approve = finish.getByRole("button", {
    name: "Approve and export · 1080p",
  });
  await expect(approve).toBeDisabled();
  expect((await read()).script_approved).toBe(false);
  await finish
    .getByLabel("I reviewed this video and accept the warnings", {
      exact: true,
    })
    .check();
  await expect(approve).toBeEnabled();
  // A second-window change invalidates this checked revision even before the UI reloads.
  await page.request.patch(`/api/projects/${project.id}`, {
    data: { title: "Changed finishing workflow" },
  });
  await approve.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "changed in another window" }),
  ).toBeVisible();
  expect((await read()).script_approved).toBe(false);
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Changed finishing workflow" })
    .click();
  await page
    .getByRole("button", { name: "Open Review & export", exact: true })
    .click();
  await expect(
    finish.getByRole("button", { name: "Check and export", exact: true }),
  ).toBeVisible();
  await finish
    .getByRole("button", { name: "Check and export", exact: true })
    .click();
  await expect(finish.getByLabel("Export checks")).toBeVisible();
  await finish
    .getByLabel("I reviewed this video and accept the warnings", {
      exact: true,
    })
    .check();
  const queued = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/projects/${project.id}/finish-export`) &&
      response.status() === 202,
  );
  await finish
    .getByRole("button", { name: "Approve and export · 1080p" })
    .click();
  const result = await (await queued).json();
  expect(result.job.quality).toBe("final");
  expect(result.project.script_approved).toBe(true);
  expect(result.project.narration_url).toBe(before.narration_url);
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/renders/${result.job.id}`)).json())
          .status,
      { timeout: 120_000 },
    )
    .toBe("completed");
  const final = await (
    await page.request.get(`/api/renders/${result.job.id}`)
  ).json();
  expect((await page.request.get(final.download_url)).status()).toBe(200);
});

test("reference video style analyzes, saves tweaks and applies real editable shots with undo", async ({
  page,
}, testInfo) => {
  await mkdir(testInfo.outputDir, { recursive: true });
  const reference = testInfo.outputPath("reference-style.mp4");
  const command = ["-v", "error", "-filter_complex_threads", "1"];
  for (const [color, seconds] of [
    ["red", 1],
    ["white", 0.1],
    ["blue", 1],
    ["green", 1],
  ])
    command.push(
      "-f",
      "lavfi",
      "-i",
      `color=c=${color}:s=160x90:r=20:d=${seconds}`,
    );
  command.push(
    "-filter_complex",
    "[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-threads",
    "2",
    "-pix_fmt",
    "yuv420p",
    "-y",
    reference,
  );
  execFileSync(process.env.CB_FFMPEG || "ffmpeg", command, { timeout: 30_000 });
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "my-art.png", mimeType: "image/png", buffer: originalPng() },
    { name: "my-voice.wav", mimeType: "audio/wav", buffer: silentWav(6) },
    {
      name: "my-words.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:03,000\nMy original words.\n\n2\n00:00:03,000 --> 00:00:06,000\nMy second line.\n",
      ),
    },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Reference editing workflow");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Verdict Autopilot", exact: true })
      .getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Reference editing workflow",
  ).id;
  const read = async () =>
    (await page.request.get(`/api/projects/${id}`)).json();
  const initial = await read();
  const reset = await page.request.put(`/api/projects/${id}/scenes`, {
    data: {
      scenes: [0, 1, 2].map((i) => ({
        panel_id: initial.scenes[0].panel_id,
        duration: 2,
        motion: "hold",
        framing: "fit",
        locked: i === 1,
      })),
    },
  });
  expect(reset.status()).toBe(200);
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Reference editing workflow" })
    .click();
  const before = await read();
  const styleBox = page.locator("details.reference-style");
  await page
    .getByRole("region", { name: "Workspace tools" })
    .getByRole("button", { name: "Open Reference style" })
    .click();
  await styleBox.getByLabel("Reference video file").setInputFiles(reference);
  const imported = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/reference-styles") &&
      r.request().method() === "POST",
  );
  await styleBox
    .getByRole("button", { name: "Analyze reference video", exact: true })
    .click();
  const source = await (await imported).json();
  expect(
    source.analysis.events.some(
      (e: { transition: string }) => e.transition === "dip_white",
    ),
  ).toBe(true);
  await expect(styleBox.getByLabel("Saved reference style")).toHaveValue(
    source.id,
  );
  await styleBox
    .getByText("Tweak and save this style recipe", { exact: true })
    .click();
  await styleBox
    .getByLabel("Reference style name", { exact: true })
    .fill("My punchy reference recipe");
  for (let i = 1; i <= source.recipe.beats.length; i++)
    await styleBox
      .getByLabel(`Reference beat ${i} duration`, { exact: true })
      .fill("0.5");
  await styleBox
    .getByLabel("Reference beat 1 camera", { exact: true })
    .selectOption("impact_shake");
  await styleBox
    .getByLabel("Reference beat 2 transition", { exact: true })
    .selectOption("slide_left");
  await styleBox
    .getByRole("button", { name: "Save tweaked style", exact: true })
    .click();
  await expect(
    page.getByText("Style recipe saved. You can reuse it in any episode.", {
      exact: true,
    }),
  ).toBeVisible();
  await styleBox
    .getByText("Tweak and save this style recipe", { exact: true })
    .click();
  await styleBox
    .getByLabel("Reference style intensity", { exact: true })
    .press("End");
  await expect(
    styleBox.getByLabel("Reference style intensity", { exact: true }),
  ).toHaveValue("1");
  await styleBox
    .getByText("Smart adaptation controls", { exact: true })
    .click();
  await styleBox.getByLabel("Reference rhythm mapping").selectOption("loop");
  await styleBox.getByLabel("Reference effect frequency").fill("120");
  await styleBox
    .getByRole("button", { name: "Propose this reference style", exact: true })
    .click();
  const proposal = page.getByLabel("Proposed editing changes", { exact: true });
  await expect(
    proposal.getByRole("button", {
      name: "Apply reviewed changes",
      exact: true,
    }),
  ).toBeVisible();
  expect((await read()).revision).toBe(before.revision);
  await proposal
    .getByRole("button", { name: "Watch proposed edit", exact: true })
    .click();
  await expect(
    page.getByText("Previewing proposed / saved edit", { exact: false }),
  ).toBeVisible();
  expect((await read()).revision).toBe(before.revision);
  await proposal
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(
    proposal.getByText("Changes applied", { exact: true }),
  ).toBeVisible();
  const edited = await read();
  expect(edited.scenes.length).toBeGreaterThan(before.scenes.length);
  expect(edited.scenes[0].motion).toBe("impact_shake");
  expect(
    edited.scenes.some(
      (s: { transition: string }) => s.transition === "slide_left",
    ),
  ).toBe(true);
  expect(edited.narration_url).toBe(before.narration_url);
  expect(edited.caption_cues).toEqual(before.caption_cues);
  expect(
    edited.scenes.filter((s: { locked: boolean }) => s.locked),
  ).toHaveLength(1);
  expect(
    edited.scenes.reduce(
      (n: number, s: { duration: number }) => n + Math.round(s.duration * 24),
      0,
    ),
  ).toBe(144);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await expect.poll(async () => (await read()).scenes.length).toBe(3);
  expect((await read()).scenes).toEqual(before.scenes);
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Reference editing workflow" })
    .click();
  await page
    .getByRole("button", { name: "Open Reference style", exact: true })
    .click();
  await styleBox.getByLabel("Saved reference style").selectOption(source.id);
  await expect(styleBox.getByLabel("Reference video playback")).toBeVisible();
  const referencePlayer = styleBox.getByLabel("Reference video playback");
  await expect
    .poll(() =>
      referencePlayer.evaluate((el: HTMLVideoElement) => el.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await referencePlayer.evaluate((el: HTMLVideoElement) => el.play());
  await expect
    .poll(() =>
      referencePlayer.evaluate((el: HTMLVideoElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await referencePlayer.evaluate((el: HTMLVideoElement) => el.pause());
  await styleBox.screenshot({
    path: testInfo.outputPath("reference-style-workflow.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await styleBox
    .getByText("Tweak and save this style recipe", { exact: true })
    .click();
  await expect(
    styleBox.getByLabel("Reference beat 1 transition", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("smart style review, consent, rendered proposal and recipe recovery work together", async ({
  page,
}, testInfo) => {
  await mkdir(testInfo.outputDir, { recursive: true });
  const referencePath = testInfo.outputPath("smart-reference.mp4");
  execFileSync(
    process.env.CB_FFMPEG || "ffmpeg",
    [
      "-v",
      "error",
      "-filter_complex_threads",
      "1",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=160x90:r=20:d=1.5",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=20:d=1.5",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-y",
      referencePath,
    ],
    { timeout: 30_000 },
  );
  await page
    .getByRole("button", { name: "Verdict Autopilot", exact: true })
    .click();
  await page.getByLabel("New project files").setInputFiles([
    { name: "smart-art.png", mimeType: "image/png", buffer: originalPng() },
    { name: "smart-voice.wav", mimeType: "audio/wav", buffer: silentWav(6) },
    {
      name: "smart-words.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:03,000\nOriginal words.\n\n2\n00:00:03,000 --> 00:00:06,000\nThe ending words.\n",
      ),
    },
  ]);
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Smart reference workflow");
  await page.getByRole("button", { name: /Create project/ }).click();
  await expect(
    page
      .getByRole("region", { name: "Verdict Autopilot", exact: true })
      .getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120_000 });
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Smart reference workflow",
  ).id;
  const read = async () =>
    (await page.request.get(`/api/projects/${id}`)).json();
  const initial = await read();
  await page.request.put(`/api/projects/${id}/scenes`, {
    data: {
      scenes: [0, 1, 2].map((i) => ({
        panel_id: initial.scenes[0].panel_id,
        duration: 2,
        motion: "hold",
        framing: "fit",
        beat: i === 0 ? "read" : i === 2 ? "hit" : "custom",
      })),
    },
  });
  const imported = await page.request.post("/api/reference-styles", {
    multipart: {
      file: {
        name: "smart-reference.mp4",
        mimeType: "video/mp4",
        buffer: await readFile(referencePath),
      },
    },
  });
  expect(imported.status()).toBe(201);
  const style = await imported.json();
  const savedStyle = await page.request.put(
    `/api/reference-styles/${style.id}`,
    {
      data: {
        base_revision: style.revision,
        name: "Smart reference recipe",
        recipe: {
          beats: [
            {
              seconds: 2,
              motion: "zoom_in",
              transition: "crossfade",
              source_start: 0,
            },
            {
              seconds: 0.5,
              motion: "impact_shake",
              transition: "cut",
              purpose: "hit",
              source_start: 1.5,
            },
          ],
          transition_duration: 0.15,
          motion_strength: 0.12,
        },
      },
    },
  );
  const saved = await savedStyle.json();
  let visionCalls = 0;
  await page.route("**/api/verdict/connection", (route) =>
    route.fulfill({
      json: {
        configured: true,
        model: "UI fixture vision model",
        base_url: "https://not-contacted.invalid/v1",
        transcription_model: "",
        has_key: false,
      },
    }),
  );
  await page.route(
    `**/api/reference-styles/${style.id}/understand`,
    async (route) => {
      expect(route.request().postDataJSON().share_frames).toBe(true);
      visionCalls++;
      await route.fulfill({
        json: {
          base_revision: saved.revision,
          model: "UI fixture vision model",
          summary: "A held opening leads to an impact.",
          shared_frames: [0.2, 1.4, 1.6, 2.7],
          unsupported_effects: [
            "Masked character isolation needs manual work.",
          ],
          observations: [
            {
              index: 1,
              purpose: "hit",
              confidence: "uncertain",
              evidence: "A close-up follows the reveal.",
            },
          ],
          recipe: {
            ...saved.recipe,
            summary: "Reviewed impact-style interpretation",
            unsupported_effects: [
              "Masked character isolation needs manual work.",
            ],
            beats: saved.recipe.beats.map((b: object) => ({
              ...b,
              motion_reviewed: false,
              transition_reviewed: false,
            })),
          },
        },
      });
    },
  );
  await page.reload();
  await page
    .locator(".project-card")
    .filter({ hasText: "Smart reference workflow" })
    .click();
  const before = await read();
  const box = page.locator("details.reference-style");
  await page
    .getByRole("button", { name: "Open Reference style", exact: true })
    .click();
  await box.getByLabel("Saved reference style").selectOption(style.id);
  await expect(
    box.getByLabel("Reference rhythm map", { exact: true }),
  ).toBeVisible();
  await box
    .getByText("Ask a vision model to interpret this style · optional", {
      exact: true,
    })
    .click();
  const interpret = box.getByRole("button", {
    name: "Interpret reference with my vision model",
    exact: true,
  });
  await expect(interpret).toBeDisabled();
  expect(visionCalls).toBe(0);
  await box
    .getByLabel("Share sampled reference frames with my vision model", {
      exact: true,
    })
    .check();
  await interpret.click();
  await expect(box.getByLabel("Vision style interpretation")).toBeVisible();
  expect(visionCalls).toBe(1);
  await box
    .getByRole("button", {
      name: "Use these reviewed suggestions in my recipe",
      exact: true,
    })
    .click();
  await box
    .getByRole("button", { name: "Save tweaked style", exact: true })
    .click();
  await expect(
    page.getByText("Style recipe saved. You can reuse it in any episode.", {
      exact: true,
    }),
  ).toBeVisible();
  await box
    .getByLabel("Reference style intensity", { exact: true })
    .press("End");
  await box.getByText("Smart adaptation controls", { exact: true }).click();
  await expect(box.getByLabel("Reference rhythm mapping")).toHaveValue(
    "structure",
  );
  await box
    .getByRole("button", { name: "Propose this reference style", exact: true })
    .click();
  const proposal = page.getByLabel("Proposed editing changes", { exact: true });
  await expect(proposal.getByLabel("Why these style changes")).toBeVisible();
  expect((await read()).revision).toBe(before.revision);
  const queued = page.waitForResponse(
    (r) =>
      r.url().includes("/assistant/proposals/") &&
      r.url().endsWith("/render") &&
      r.status() === 202,
  );
  await proposal
    .getByRole("button", {
      name: "Render proposed edit · actual effects",
      exact: true,
    })
    .click();
  const job = await (await queued).json();
  expect(job.proposal_id).toBeTruthy();
  await expect(
    proposal.getByLabel("Proposed edit rendered playback"),
  ).toBeVisible({ timeout: 120_000 });
  const renderedPlayer = proposal.getByLabel("Proposed edit rendered playback");
  await renderedPlayer.focus();
  await renderedPlayer.press("Space");
  await expect
    .poll(() =>
      renderedPlayer.evaluate((el: HTMLVideoElement) => el.currentTime),
    )
    .toBeGreaterThan(0);
  await renderedPlayer.press("Space");
  expect(await read()).toEqual(before);
  const check = await (
    await page.request.get(`/api/projects/${id}/finish-check`)
  ).json();
  expect(check.scanned_render_id).toBeNull();
  await expect(
    proposal.getByRole("button", {
      name: "Apply reviewed changes",
      exact: true,
    }),
  ).toBeEnabled();
  await proposal.screenshot({
    path: testInfo.outputPath("smart-proposed-render.png"),
  });
  await proposal
    .getByRole("button", { name: "Apply reviewed changes", exact: true })
    .click();
  await expect(
    proposal.getByText("Changes applied", { exact: true }),
  ).toBeVisible();
  expect((await read()).narration_url).toBe(before.narration_url);
  const appliedRevision = (await read()).revision;
  if (
    !(await box
      .locator("details.reference-recipe")
      .evaluate((el) => el.hasAttribute("open")))
  )
    await box
      .getByText("Tweak and save this style recipe", { exact: true })
      .click();
  await box
    .getByRole("button", { name: "Save as separate style", exact: true })
    .click();
  await expect(
    page.getByText(
      "Saved as a separate style. The original recipe is intact.",
      { exact: true },
    ),
  ).toBeVisible();
  const copyId = await box.getByLabel("Saved reference style").inputValue();
  expect(copyId).not.toBe(style.id);
  await box
    .getByLabel("Reference style name", { exact: true })
    .fill("Changed copy name");
  await box
    .getByRole("button", { name: "Save tweaked style", exact: true })
    .click();
  await box
    .getByRole("button", { name: "Show saved recipe versions", exact: true })
    .click();
  await box
    .getByRole("button", { name: "Restore recipe revision 1", exact: true })
    .click();
  await expect(page.getByText(/Recipe version restored/)).toBeVisible();
  const downloading = page.waitForEvent("download");
  await box
    .getByRole("link", { name: "Export recipe JSON", exact: true })
    .click();
  const download = await downloading;
  const recipePath = testInfo.outputPath("style-backup.json");
  await download.saveAs(recipePath);
  const recipe = JSON.parse(await readFile(recipePath, "utf8"));
  expect(recipe.format).toBe("comic-beatdowns-reference-style");
  await box.getByText("Import a saved recipe JSON", { exact: true }).click();
  await box.getByLabel("Import style recipe file").setInputFiles(recipePath);
  await box
    .getByRole("button", { name: "Import style recipe", exact: true })
    .click();
  await expect(
    page.getByText(
      "Style recipe imported. It works without retaining the reference video.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await read()).revision).toBe(appliedRevision);
  expect(visionCalls).toBe(1);
});

test("saved drafts reopen for simple re-editing and preview changes without rebuilding", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Make a video", exact: true }).click();
  await page
    .getByLabel("Project title", { exact: true })
    .fill("Simple re-edit flow");
  await page.getByLabel("New project files").setInputFiles([
    { name: "page.png", mimeType: "image/png", buffer: originalPng() },
    { name: "voice.wav", mimeType: "audio/wav", buffer: silentWav(2) },
    {
      name: "words.srt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:02,000\nOne panel, one clear point.\n",
      ),
    },
  ]);
  await page.getByRole("button", { name: /Create project/ }).click();
  const director = page.getByRole("region", {
    name: "Verdict Autopilot",
    exact: true,
  });
  await expect(
    director.getByRole("button", { name: "Approve & export 1080p" }),
  ).toBeVisible({ timeout: 120000 });
  const projects = await (await page.request.get("/api/projects")).json();
  const id = projects.find(
    (p: { title: string }) => p.title === "Simple re-edit flow",
  ).id;
  const read = async () =>
    (await page.request.get(`/api/projects/${id}`)).json();
  const before = await read();
  const jobsBefore = await (
    await page.request.get(`/api/projects/${id}/director`)
  ).json();
  const guide = page.getByRole("region", { name: "Easy video creation" });
  await guide.getByRole("button", { name: "Edit this draft" }).click();
  const shots = page.getByRole("region", { name: "Quick shot editor" });
  await expect(shots).toBeVisible();
  await expect(director).not.toBeVisible();
  await expect(page.getByLabel("Reference video file")).not.toBeVisible();
  await shots
    .getByRole("button", { name: "Fit whole panel", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).revision)
    .toBeGreaterThan(before.revision);
  const edited = await read();
  await expect(
    guide.getByRole("button", { name: "Preview my changes" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Preview my changes" }).click();
  await expect
    .poll(async () => {
      const jobs = await (
        await page.request.get(`/api/renders?project_id=${id}`)
      ).json();
      return jobs.some(
        (job: { project_revision: number; status: string }) =>
          job.project_revision === edited.revision &&
          job.status === "completed",
      );
    })
    .toBeTruthy();
  const jobsAfter = await (
    await page.request.get(`/api/projects/${id}/director`)
  ).json();
  expect(jobsAfter.map((job: { id: string }) => job.id)).toEqual(
    jobsBefore.map((job: { id: string }) => job.id),
  );
  expect((await read()).scenes).toEqual(edited.scenes);
  await page
    .getByRole("region", { name: "Workspace tools" })
    .screenshot({ path: testInfo.outputPath("focused-workspace-desktop.png") });
  await shots.getByRole("button", { name: "Undo edit", exact: true }).click();
  await expect.poll(async () => (await read()).scenes).toEqual(before.scenes);
});
