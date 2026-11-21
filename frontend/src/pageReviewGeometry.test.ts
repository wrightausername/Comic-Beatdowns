import { describe, expect, it } from "vitest";
import { drawCrop, moveCrop, resizeCrop, scaleCrop } from "./pageReviewGeometry";

const original = { x: 0.2, y: 0.3, width: 0.5, height: 0.4 };

describe("safe visual crop adjustments", () => {
  it("moves a crop inside its original source page without changing its size", () => {
    expect(moveCrop(original, 0.1, -0.1)).toEqual({
      x: 0.3, y: 0.2, width: 0.5, height: 0.4,
    });
    expect(moveCrop(original, 2, -2)).toEqual({
      x: 0.5, y: 0, width: 0.5, height: 0.4,
    });
    expect(original.x).toBe(0.2);
  });
  it("prevents resizing outside the image or below the minimum usable region", () => {
    expect(resizeCrop(original, 2, 2)).toEqual({
      x: 0.2, y: 0.3, width: 0.8, height: 0.7,
    });
    expect(resizeCrop(original, -4, -4)).toEqual({
      x: 0.2, y: 0.3, width: 0.03, height: 0.03,
    });
  });
  it("draws replacement crops in either drag direction and rejects tiny taps", () => {
    expect(drawCrop(0.8, 0.9, 0.2, 0.4)).toEqual({
      x: 0.2, y: 0.4, width: 0.6, height: 0.5,
    });
    expect(drawCrop(0.1, 0.1, 0.11, 0.12)).toBeNull();
  });
  it("shows more art or tightens a crop while keeping it within the original", () => {
    const wide = scaleCrop(original, 1.2);
    const tight = scaleCrop(original, 0.8);
    expect(wide.width).toBeCloseTo(0.6);
    expect(tight.width).toBeCloseTo(0.4);
    expect(wide.x + wide.width / 2).toBeCloseTo(original.x + original.width / 2);
    expect(tight.y + tight.height / 2).toBeCloseTo(original.y + original.height / 2);
    expect(scaleCrop({ x: 0, y: 0, width: 1, height: 1 }, 1.2)).toEqual({
      x: 0, y: 0, width: 1, height: 1,
    });
  });
});
