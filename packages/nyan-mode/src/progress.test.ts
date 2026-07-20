import { describe, expect, it } from "vitest";

import { animationFrame, normalizeProgress, progressPixelBucket } from "./progress.ts";

describe("Nyan progress", () => {
  it("normalizes context percentages", () => {
    expect(normalizeProgress(undefined)).toBe(0);
    expect(normalizeProgress(null)).toBe(0);
    expect(normalizeProgress(Number.NaN)).toBe(0);
    expect(normalizeProgress(-1)).toBe(0);
    expect(normalizeProgress(0)).toBe(0);
    expect(normalizeProgress(25)).toBe(0.25);
    expect(normalizeProgress(100)).toBe(1);
    expect(normalizeProgress(101)).toBe(1);
  });

  it("cycles positive animation frames and reserves zero for static art", () => {
    expect([Number.NaN, -1, 0].map(animationFrame)).toEqual([0, 0, 0]);
    expect([1, 2, 6, 7, 8, 12].map(animationFrame)).toEqual([1, 2, 6, 1, 2, 6]);
    expect(animationFrame(2.9)).toBe(2);
  });

  it("maps normalized progress onto runway pixels", () => {
    expect(progressPixelBucket(8, -1)).toBe(0);
    expect(progressPixelBucket(8, 0.25)).toBe(16);
    expect(progressPixelBucket(8, 1)).toBe(64);
    expect(progressPixelBucket(8, 2)).toBe(64);
    expect(progressPixelBucket(0, 0.5)).toBe(4);
  });
});
