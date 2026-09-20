import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { BRAILLE_SPINNERS, pickSpinner } from "./spinners.ts";

const FIRST = BRAILLE_SPINNERS[0];

describe("BRAILLE_SPINNERS", () => {
  it("describes every spinner", () => {
    for (const spinner of BRAILLE_SPINNERS) {
      expect(spinner.id).toMatch(/^[a-z-]+$/u);
      expect(spinner.name.length).toBeGreaterThan(0);
      expect(spinner.description.length).toBeGreaterThan(0);
      expect(spinner.intervalMs).toBeGreaterThan(0);
      expect(spinner.frames.length).toBeGreaterThan(1);
    }
  });

  it("keeps every id and animation unique", () => {
    const ids = new Set(BRAILLE_SPINNERS.map((spinner) => spinner.id));
    const animations = new Set(BRAILLE_SPINNERS.map((spinner) => spinner.frames.join("|")));

    expect(ids.size).toBe(BRAILLE_SPINNERS.length);
    expect(animations.size).toBe(BRAILLE_SPINNERS.length);
  });

  it("keeps every frame at exactly two braille columns", () => {
    for (const spinner of BRAILLE_SPINNERS) {
      for (const frame of spinner.frames) {
        expect(frame.length).toBe(2);
        for (const glyph of frame) {
          const point = glyph.codePointAt(0) ?? 0;
          expect(point).toBeGreaterThanOrEqual(0x2800);
          expect(point).toBeLessThanOrEqual(0x28ff);
        }
        expect(visibleWidth(frame)).toBe(2);
      }
    }
  });

  it("moves every spinner through more than one shape", () => {
    for (const spinner of BRAILLE_SPINNERS) {
      expect(new Set(spinner.frames).size).toBeGreaterThan(1);
    }
  });
});

describe("pickSpinner", () => {
  it("picks a spinner from the set", () => {
    expect(BRAILLE_SPINNERS).toContain(pickSpinner());
  });

  it("maps the ends of the random range", () => {
    expect(pickSpinner(() => 0)).toBe(FIRST);
    expect(pickSpinner(() => 0.9999)).toBe(BRAILLE_SPINNERS.at(-1));
  });

  it("wraps a random value at or above one", () => {
    expect(pickSpinner(() => 1)).toBe(FIRST);
    expect(pickSpinner(() => 1.25)).toBe(pickSpinner(() => 0.25));
  });
});
