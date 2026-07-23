import { describe, expect, it } from "vitest";

import { animationFrame, normalizeAvailableProgress, progressPixelBucket } from "./progress.ts";

describe("Nyan progress", () => {
  it("normalizes remaining context from used percentages", () => {
    expect(normalizeAvailableProgress(undefined)).toBe(1);
    expect(normalizeAvailableProgress(null)).toBe(1);
    expect(normalizeAvailableProgress(Number.NaN)).toBe(1);
    expect(normalizeAvailableProgress(-1)).toBe(1);
    expect(normalizeAvailableProgress(0)).toBe(1);
    expect(normalizeAvailableProgress(25)).toBe(0.75);
    expect(normalizeAvailableProgress(100)).toBe(0);
    expect(normalizeAvailableProgress(101)).toBe(0);
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
