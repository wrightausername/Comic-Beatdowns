import { describe, expect, it } from "vitest";
import type { Scene } from "./types";
import { moveItem, spokenSeconds, timecode, timelineSeconds } from "./utils";

describe("timeline editing", () => {
  it("moves a scene without losing or duplicating content", () => {
    const scenes = ["hook", "punch", "verdict"];
    expect(moveItem(scenes, 0, 2)).toEqual(["punch", "verdict", "hook"]);
    expect(scenes).toEqual(["hook", "punch", "verdict"]);
    expect(moveItem(scenes, 0, -1)).toBe(scenes);
  });
  it("uses output frame timing, including fractional durations", () => {
    expect(
      timelineSeconds([{ duration: 0.26 }, { duration: 1.13 }] as Scene[], 24),
    ).toBe(33 / 24);
  });
  it("estimates commentary runtime without counting empty words", () => {
    expect(spokenSeconds("")).toBe(0);
    expect(spokenSeconds(Array(189).fill("word").join(" "))).toBe(70);
  });
  it("formats a timeline timecode", () => {
    expect(timecode(75)).toBe("1:15");
    expect(timecode(59.8)).toBe("1:00");
  });
});
