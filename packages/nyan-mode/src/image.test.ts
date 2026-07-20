import { describe, expect, it } from "vitest";

import { getCachedNyanPng } from "./image.ts";
import { DEFAULT_ASSET_DIR } from "./xpm.ts";

describe("Nyan image composition", () => {
  it("builds and caches animated PNG frames", () => {
    const cache = new Map<string, string>();
    const first = getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 16, 0.5, 1);
    expect(first).toBeDefined();
    expect(
      Buffer.from(first ?? "", "base64")
        .subarray(1, 4)
        .toString("ascii"),
    ).toBe("PNG");
    expect(getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 16, 0.5, 1)).toBe(first);
    expect(cache.size).toBe(1);
  });

  it("moves the cat, cycles frames, and enforces the minimum width", () => {
    const cache = new Map<string, string>();
    const start = getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 8, 0, 1);
    const end = getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 8, 1, 1);
    expect(end).not.toBe(start);
    expect(getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 8, 0, 7)).toBe(start);
    expect(getCachedNyanPng(new Map(), DEFAULT_ASSET_DIR, 1, 0, 1)).toBe(start);
  });

  it("returns no image for an incomplete asset directory", () => {
    expect(getCachedNyanPng(new Map(), "/missing/nyan-assets", 8, 0, 1)).toBeUndefined();
  });

  it("bounds the generated PNG cache", () => {
    const cache = new Map<string, string>();
    for (let index = 0; index < 240; index += 1) cache.set(`old-${String(index)}`, "old");
    expect(getCachedNyanPng(cache, DEFAULT_ASSET_DIR, 8, 0, 1)).toBeDefined();
    expect(cache.size).toBe(240);
    expect(cache.has("old-0")).toBe(false);
  });
});
