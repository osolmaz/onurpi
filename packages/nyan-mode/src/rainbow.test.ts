import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import { renderAnsiRainbow } from "./rainbow.ts";

describe("ANSI rainbow runway", () => {
  it("fills the requested cells with the complete rainbow palette", () => {
    const runway = renderAnsiRainbow(7);
    expect(visibleWidth(runway)).toBe(7);
    for (const color of [196, 208, 226, 46, 51, 21, 201]) {
      expect(runway).toContain(`\x1b[38;5;${String(color)}m`);
    }
    expect(runway.endsWith("\x1b[39m")).toBe(true);
  });

  it("floors widths and returns an empty runway for non-positive widths", () => {
    expect(visibleWidth(renderAnsiRainbow(2.9))).toBe(2);
    expect(renderAnsiRainbow(0)).toBe("");
    expect(renderAnsiRainbow(-2)).toBe("");
  });
});
