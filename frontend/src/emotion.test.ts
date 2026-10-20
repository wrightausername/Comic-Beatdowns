import { describe, expect, it } from "vitest";
import type { CaptionCue, Scene } from "./types";
import {
  applyPerformanceCues,
  parsePerformanceScript,
  timePerformanceCues,
} from "./emotion";

describe("Verdict script performance directions", () => {
  it("strips only recognized directions from spoken dialogue", () => {
    const result = parsePerformanceScript(
      "[DISBELIEF, escalating] Flash outran death. [PAUSE 0.8s, DEADPAN] And Captain Cold won? (Issue #17)",
    );
    expect(result.cues.map((cue) => cue.kind)).toEqual([
      "disbelief",
      "escalating",
      "pause",
      "deadpan",
    ]);
    expect(result.cues[2].pauseSeconds).toBe(0.8);
    expect(result.dialogue).not.toContain("DEADPAN");
    expect(result.dialogue).toContain("(Issue #17)");
  });

  it("aligns markers to timed spoken captions where available", () => {
    const captions: CaptionCue[] = [
      { start: 0, end: 2, text: "Flash outran death" },
      { start: 3, end: 5, text: "And Cold won" },
    ];
    const marks = timePerformanceCues(
      "Flash outran death. [DEADPAN] And Cold won.",
      captions,
      6,
    );
    expect(marks).toHaveLength(1);
    expect(marks[0].time).toBeCloseTo(3);
    expect(marks[0].estimated).toBe(false);
  });

  it("uses explicit manual timing overrides without editing dialogue", () => {
    const script = "What? [FRUSTRATED] How?";
    const original = timePerformanceCues(script, [], 10);
    const cues = timePerformanceCues(script, [], 10, 0, {
      [original[0].id]: 7.2,
    });
    expect(cues[0].time).toBe(7.2);
    expect(cues[0].estimated).toBe(false);
  });

  it("does not change locked shots or the total running time", () => {
    const scenes = [
      { duration: 3, locked: true, motion: "hold" },
      { duration: 3, locked: false, motion: "hold" },
    ] as Scene[];
    const cues = timePerformanceCues(
      "[SHOUTING] No! [PAUSE 0.8s] Seriously?",
      [],
      6,
    );
    const outcome = applyPerformanceCues(scenes, cues, 30);
    expect(outcome.changed).toBe(1);
    expect(outcome.scenes[0].motion).toBe("hold");
    expect(outcome.scenes[1].duration).toBe(3);
  });

  it("applies camera guidance to an unlocked matching scene", () => {
    const scenes = [
      { duration: 3, locked: false, motion: "hold" },
      { duration: 3, locked: false, motion: "hold" },
    ] as Scene[];
    const cues = timePerformanceCues("Start. [SHOUTING] Now!", [], 6);
    const outcome = applyPerformanceCues(scenes, cues, 30);
    expect(outcome.changed).toBe(1);
    expect(outcome.scenes[1].motion).toBe("punch_in");
    expect(scenes[1].motion).toBe("hold");
  });
});
