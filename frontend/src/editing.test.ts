import { expect, it } from "vitest";
import {
  applyStoryboard,
  fitScenes,
  mergePageShots,
  selectExcerpt,
  splitScene,
} from "./editing";
import type { Scene, VideoSettings } from "./types";
const scene = (id: string, duration = 2): Scene => ({
  id,
  duration,
  panel_id: id,
  position: 0,
  motion: "punch_in",
  motion_strength: 0.22,
  easing: "ease_out",
  focus_x: 0.5,
  focus_y: 0.5,
  transition: "cut",
  transition_duration: null,
  caption: "",
  sfx_url: null,
  panel: { id, title: id } as Scene["panel"],
});
it("fits only unlocked shots and preserves an exact frame budget", () => {
  const locked = { ...scene("locked"), locked: true },
    values = [locked, scene("a"), scene("b")];
  const result = fitScenes(values, 7.07, 24);
  expect(result[0]).toBe(locked);
  expect(result.reduce((sum, s) => sum + Math.round(s.duration * 24), 0)).toBe(
    Math.ceil(7.07 * 24),
  );
  expect(values[1].duration).toBe(2);
  expect(() => fitScenes([locked], 1, 24)).toThrow("Unlock");
});
it("splits a shot without duplicating its uploaded sound", () => {
  const source = {
    ...scene("source"),
    sfx_url: "/custom.wav",
    sfx_source_id: "source",
    sfx_offset: 0.3,
  };
  const result = splitScene([source], 0, 24);
  expect(result).toHaveLength(2);
  expect(result[0].sfx_url).toBe("/custom.wav");
  expect(result[1].sfx_url).toBeNull();
  expect(result[1].sfx_source_id).toBeNull();
  expect(result[1].clear_sfx).toBe(true);
  expect(result[0].duration + result[1].duration).toBe(2);
});
it("moves a later sound to the second half of a split", () => {
  const result = splitScene(
    [
      {
        ...scene("source"),
        sfx_url: "/hit.wav",
        sfx_source_id: "source",
        sfx_offset: 1.5,
      },
    ],
    0,
    24,
  );
  expect(result[0].clear_sfx).toBe(true);
  expect(result[1].sfx_source_id).toBe("source");
  expect(result[1].sfx_offset).toBe(0.5);
});
it("refuses to split locked or too-short shots", () => {
  const locked = [{ ...scene("locked"), locked: true }];
  expect(splitScene(locked, 0, 24)).toBe(locked);
  const short = [scene("short", 0.25)];
  expect(splitScene(short, 0, 24)).toBe(short);
});
it("applies narration assignments without changing locked panels", () => {
  const result = applyStoryboard(
    [{ ...scene("locked"), locked: true }, scene("open")],
    [{ start: 5, end: 9, text: "A hit", panel_id: "replacement", beat: "hit" }],
    5,
    24,
  );
  expect(result[0].panel_id).toBe("locked");
  expect(result[1].panel_id).toBe("replacement");
});
it("selects an excerpt and preserves original-source caption time", () => {
  const settings = {
    fps: 24,
    narration_start: 10,
    narration_end: 14,
  } as VideoSettings;
  const result = selectExcerpt([scene("a"), scene("b")], settings, 1, 3);
  expect(result.scenes.map((s) => s.duration)).toEqual([1, 1]);
  expect(result.settings.narration_start).toBe(11);
  expect(result.settings.narration_end).toBe(13);
  expect(() =>
    selectExcerpt(
      [{ ...scene("a"), locked: true }, scene("b")],
      settings,
      1,
      3,
    ),
  ).toThrow("Unlock");
});

it("joins two proposed page regions into one long panel without shifting speech timing", () => {
  const page = { id: "page", width: 800, height: 800 } as Scene["panel"];
  const first = {
    ...scene("a", 1.5),
    panel_id: "page",
    panel: page,
    note: "Left",
    source_crop: { x: 0.1, y: 0.1, width: 0.35, height: 0.25 },
    sfx_url: "/impact.wav",
  };
  const second = {
    ...scene("b", 2),
    panel_id: "page",
    panel: page,
    note: "Right",
    source_crop: { x: 0.5, y: 0.1, width: 0.38, height: 0.25 },
  };
  const third = scene("untouched", 1);
  const merged = mergePageShots([first, second, third], 0);
  expect(merged).toHaveLength(2);
  expect(merged[0].id).toBe("a");
  expect(merged[0].duration).toBe(3.5);
  expect(merged[0].source_crop).toEqual({
    x: 0.1, y: 0.1, width: 0.78, height: 0.25,
  });
  expect(merged[0].motion).toBe("panel_glide");
  expect(merged[0].glide_axis).toBe("horizontal");
  expect(merged[0].sfx_url).toBe("/impact.wav");
  expect(merged[0].note).toContain("Right");
  expect(merged[1]).toBe(third);
  expect(merged.reduce((sum, shot) => sum + shot.duration, 0)).toBe(4.5);
});

it("refuses unsafe joins that would discard voice captions or scene effects", () => {
  const page = { id: "page", width: 800, height: 800 } as Scene["panel"];
  const first = {
    ...scene("a"),
    panel_id: "page",
    panel: page,
    source_crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
  };
  const second = {
    ...scene("b"),
    panel_id: "page",
    panel: page,
    source_crop: { x: 0.5, y: 0, width: 0.5, height: 0.5 },
  };
  expect(() => mergePageShots([first, { ...second, locked: true }], 0))
    .toThrow("unlocked");
  expect(() => mergePageShots([first, { ...second, caption: "Don't drop me" }], 0))
    .toThrow("dialogue or audio");
  expect(() => mergePageShots([first, { ...second, sfx_url: "/hit.wav" }], 0))
    .toThrow("dialogue or audio");
  expect(() => mergePageShots([first, { ...second, panel_id: "another" }], 0))
    .toThrow("same original");
  expect(() => mergePageShots([first, { ...second, duration: 30 }], 0))
    .toThrow("at most 30");
});
