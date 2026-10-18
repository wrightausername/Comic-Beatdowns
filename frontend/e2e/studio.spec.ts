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
function silentWav() {
  const audio = Buffer.alloc(44 + 16000 * 2);
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
    path: testInfo.outputPath("mobile-production.png"),
    fullPage: true,
  });
});
