import { expect, test } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";

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

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Studio access token")
    .fill("e2e-only-studio-token-not-a-real-secret");
  await page.getByRole("button", { name: "Enter the studio" }).click();
  await expect(
    page.getByRole("heading", { name: "The production desk." }),
  ).toBeVisible();
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
  await page.getByLabel("Upload narration").setInputFiles({
    name: "original-silence.wav",
    mimeType: "audio/wav",
    buffer: silentWav(),
  });
  await expect(
    page.getByText("Narration uploaded and normalized."),
  ).toBeVisible();
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
  await page.getByLabel("Upload narration").setInputFiles({
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
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Scene 1 motion", { exact: true })).toHaveValue(
    "punch_in",
  );
  await page.getByRole("button", { name: "Redo", exact: true }).click();
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
  await page.screenshot({
    path: testInfo.outputPath("verdict-autopilot.png"),
    timeout: 60_000,
  });
  await card
    .getByLabel("I checked the preview, captions, and panel matches.")
    .check();
  await approve.click();
  await page.getByRole("button", { name: "Exports", exact: true }).click();
  const download = page
    .locator(".export-card")
    .filter({ hasText: "Final · 1080p" })
    .getByRole("link", { name: "Download MP4" });
  await expect(download).toBeVisible({ timeout: 120_000 });
  const fileEvent = page.waitForEvent("download");
  await download.click();
  const file = await fileEvent;
  expect(file.suggestedFilename()).toContain("Verdict_upload_handoff_Final");
  expect(errors).toEqual([]);
});
