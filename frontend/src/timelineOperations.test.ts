import { expect, it } from "vitest";
import type { Scene } from "./types";
import {
  trimTimelineShot,
  moveTimelineShot,
  deleteTimelineShots,
  duplicateTimelineShot,
  snapTimelineTime,
} from "./timelineOperations";
const shots = [1, 2, 3].map((n) => ({
  id: `s${n}`,
  duration: 2,
  panel_id: `p${n}`,
})) as Scene[];
it("rolls either clip edge on whole frames while retaining total length", () => {
  const right = trimTimelineShot(shots, 0, "right", 6, 24);
  expect(right.map((s) => s.duration)).toEqual([2.25, 1.75, 2]);
  const left = trimTimelineShot(shots, 1, "left", 6, 24);
  expect(left.map((s) => s.duration)).toEqual([2.25, 1.75, 2]);
  const clamped = trimTimelineShot(shots, 0, "right", 240, 24);
  expect(clamped.map((s) => s.duration)).toEqual([3.75, 0.25, 2]);
  expect(shots[0].duration).toBe(2);
});
it("protects locked intervals for reorder, ripple edit, delete and duplicate", () => {
  const locked = shots.map((s, i) => (i === 1 ? { ...s, locked: true } : s));
  expect(moveTimelineShot(locked, 0, 2)).toBe(locked);
  expect(trimTimelineShot(locked, 0, "right", 5, 24)).toBe(locked);
  expect(trimTimelineShot(locked, 0, "right", 5, 24, false)).toBe(locked);
  expect(deleteTimelineShots(locked, new Set(["s1"]))).toBe(locked);
  expect(duplicateTimelineShot(locked, 0)).toBe(locked);
  expect(deleteTimelineShots(locked, new Set(["s3"]))).toHaveLength(2);
});
it("reorders and duplicates asset references and deletes selected shots", () => {
  expect(moveTimelineShot(shots, 0, 2).map((s) => s.id)).toEqual([
    "s2",
    "s3",
    "s1",
  ]);
  const result = duplicateTimelineShot(shots, 0);
  expect(result[1].id).not.toBe("s1");
  expect(result[1].sfx_source_id).toBe("s1");
  expect(result[1].panel_id).toBe("p1");
  expect(
    deleteTimelineShots(shots, new Set(["s1", "s3"])).map((s) => s.id),
  ).toEqual(["s2"]);
});
it("ripple trims explicitly and snaps only inside the chosen tolerance", () => {
  expect(trimTimelineShot(shots, 2, "right", 12, 24, false)[2].duration).toBe(
    2.5,
  );
  expect(snapTimelineTime(1.97, [1, 2, 3], 0.1, 24)).toBe(2);
  expect(snapTimelineTime(1.7, [1, 2, 3], 0.1, 24)).toBe(41 / 24);
});
