import { describe, expect, it } from "vitest";

import { assetsAvailable, DEFAULT_ASSET_DIR, loadXpm, parseXpm } from "./xpm.ts";

function pixelBytes(source: string): number[] {
  return [...parseXpm(source).pixels];
}

describe("XPM parsing", () => {
  it("parses hexadecimal and transparent pixels", () => {
    const source = `
      "2 1 2 1",
      "a c #ff0000",
      ". c None",
      "a."
    `;
    expect(parseXpm(source)).toMatchObject({ width: 2, height: 1 });
    expect(pixelBytes(source)).toEqual([255, 0, 0, 255, 0, 0, 0, 0]);
  });

  it("parses named, gray, and unknown colors", () => {
    const source = `
      "5 1 5 1",
      "a c black",
      "b c white",
      "c c grey50",
      "d c unexpected",
      "e c None",
      "abcde"
    `;
    expect(pixelBytes(source)).toEqual([
      0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 255, 255, 0, 0, 0, 0,
    ]);
  });

  it("rejects incomplete XPM input", () => {
    expect(() => parseXpm("not an xpm")).toThrow("missing header");
    expect(() => parseXpm('"0 1 1 1"')).toThrow("invalid header");
    expect(() => parseXpm('"1 1 1 1"\n"a"')).toThrow("missing pixel row");
    expect(() => parseXpm('"1 1 1 1"\n""')).toThrow("missing color");
  });
});

describe("bundled assets", () => {
  it("loads the complete vendored artwork", () => {
    expect(assetsAvailable(DEFAULT_ASSET_DIR)).toBe(true);
    expect(loadXpm(DEFAULT_ASSET_DIR, "nyan-frame-1.xpm")).toMatchObject({
      width: 25,
      height: 15,
    });
    expect(loadXpm(DEFAULT_ASSET_DIR, "missing.xpm")).toBeUndefined();
  });
});
