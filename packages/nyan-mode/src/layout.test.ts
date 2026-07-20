import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  composeLine,
  fitRunway,
  formatContext,
  formatCount,
  joinParts,
  shortModel,
} from "./layout.ts";

describe("footer layout", () => {
  it("fits a runway between footer sides", () => {
    expect(fitRunway("left", "right", 30)).toEqual({
      cells: 19,
      left: "left",
      right: "right",
      startColumn: 6,
    });
  });

  it("truncates footer sides before giving up", () => {
    const fitted = fitRunway("a very long project and branch", "context model details", 32);
    expect(fitted).toBeDefined();
    expect(fitted?.cells).toBeGreaterThanOrEqual(8);
    expect(
      visibleWidth(
        `${fitted?.left ?? ""} ${" ".repeat(fitted?.cells ?? 0)} ${fitted?.right ?? ""}`,
      ),
    ).toBeLessThanOrEqual(32);
    expect(fitRunway("left", "right", 5)).toBeUndefined();
  });

  it("composes aligned and narrow fallback lines", () => {
    const wide = composeLine("left", "center", "right", 30);
    expect(visibleWidth(wide)).toBe(30);
    expect(wide).toContain("center");
    expect(composeLine("left", "center", "right", 0)).toBe("");

    const narrow = composeLine("a very long left side", "center", "a long right side", 20);
    expect(visibleWidth(narrow)).toBe(20);
    expect(narrow).not.toContain("center");
  });
});

describe("footer labels", () => {
  it("formats context windows and compact counts", () => {
    expect(formatContext(undefined, undefined)).toBe("ctx ?/?");
    expect(formatContext(34.4, 128_000)).toBe("ctx 34%/128k");
    expect([999, 1_250, 12_500, 1_250_000].map(formatCount)).toEqual([
      "999",
      "1.3k",
      "13k",
      "1.3M",
    ]);
  });

  it("shortens common model identifiers and joins present labels", () => {
    expect(shortModel("claude-sonnet-4-20250514")).toBe("sonnet-4");
    expect(shortModel("gpt-5-preview")).toBe("gpt5");
    expect(shortModel("model-latest")).toBe("model");
    expect(joinParts(["left", undefined, "right", ""])).toBe("left right");
  });
});
