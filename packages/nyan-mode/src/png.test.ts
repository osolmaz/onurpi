import { describe, expect, it } from "vitest";

import { encodePngRgba } from "./png.ts";

describe("PNG encoding", () => {
  it("encodes deterministic RGBA pixels", () => {
    expect(encodePngRgba(1, 1, Buffer.from([255, 0, 0, 255]))).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    );
  });

  it("preserves dimensions and rows", () => {
    const png = Buffer.from(
      encodePngRgba(2, 1, Buffer.from([255, 0, 0, 255, 0, 255, 0, 128])),
      "base64",
    );
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(1);
  });

  it("rejects invalid dimensions and pixel lengths", () => {
    expect(() => encodePngRgba(0, 1, Buffer.alloc(0))).toThrow("positive integers");
    expect(() => encodePngRgba(1.5, 1, Buffer.alloc(8))).toThrow("positive integers");
    expect(() => encodePngRgba(1, 1, Buffer.alloc(3))).toThrow("does not match");
  });
});
