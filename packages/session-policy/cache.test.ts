import { describe, expect, it } from "vitest";

import { ImageCache, type CachedImage } from "./cache.ts";

function image(size: number, mimeType = "image/png"): CachedImage {
  return { data: "a".repeat(size), mimeType };
}

describe("ImageCache", () => {
  it("stores, reads, and reports its size", () => {
    const cache = new ImageCache(100);
    cache.set("a", image(40));
    expect(cache.get("a")).toEqual(image(40));
    expect(cache.has("a")).toBe(true);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.has("missing")).toBe(false);
    expect(cache.count).toBe(1);
    expect(cache.bytes).toBe(40);
    expect(cache.maxBytes).toBe(100);
    expect(cache.hashes()).toEqual(["a"]);
  });

  it("keeps one entry for identical payloads", () => {
    const cache = new ImageCache(100);
    cache.set("a", image(40));
    cache.set("a", image(40));
    cache.set("b", image(40));
    expect(cache.count).toBe(2);
    expect(cache.bytes).toBe(80);
    expect(cache.hashes()).toEqual(["a", "b"]);
  });

  it("evicts oldest first and never exceeds the limit", () => {
    const cache = new ImageCache(100);
    cache.set("a", image(60));
    cache.set("b", image(60));
    expect(cache.hashes()).toEqual(["b"]);
    expect(cache.bytes).toBe(60);
  });

  it("does not keep an image larger than the whole limit", () => {
    const cache = new ImageCache(100);
    cache.set("a", image(120));
    expect(cache.count).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });

  it("retains only live hashes", () => {
    const cache = new ImageCache(1000);
    cache.set("a", image(10));
    cache.set("b", image(20));
    cache.set("c", image(30));
    expect(cache.retain(new Set(["a", "c"]))).toBe(1);
    expect(cache.hashes()).toEqual(["a", "c"]);
    expect(cache.bytes).toBe(40);
    expect(cache.retain(new Set(["a", "c"]))).toBe(0);
  });

  it("clears every entry", () => {
    const cache = new ImageCache(1000);
    cache.set("a", image(10));
    cache.clear();
    expect(cache.count).toBe(0);
    expect(cache.bytes).toBe(0);
    expect(cache.hashes()).toEqual([]);
  });

  it("evicts again when the limit shrinks", () => {
    const cache = new ImageCache(1000);
    cache.set("a", image(10));
    cache.set("b", image(10));
    cache.set("c", image(10));
    cache.setLimit(20);
    expect(cache.maxBytes).toBe(20);
    expect(cache.hashes()).toEqual(["b", "c"]);
    expect(cache.bytes).toBe(20);
  });
});
