import { describe, expect, it } from "vitest";

import { catColorToken, catStyler, type CatTheme } from "./cat-color.ts";

describe("cat context-stress color", () => {
  it("escalates from the normal color through warning, vivid stress, and error", () => {
    expect(catColorToken("none")).toBeUndefined();
    expect(catColorToken("watch")).toBe("warning");
    expect(catColorToken("stressed")).toBe("thinkingHigh");
    expect(catColorToken("critical")).toBe("error");
  });

  it("applies the selected theme color without styling calm cats", () => {
    const theme: CatTheme = {
      fg(color, text) {
        return `<${color}>${text}</${color}>`;
      },
    };
    expect(catStyler(theme, "none")).toBeUndefined();
    expect(catStyler(theme, "watch")?.("cat")).toBe("<warning>cat</warning>");
    expect(catStyler(theme, "stressed")?.("cat")).toBe("<thinkingHigh>cat</thinkingHigh>");
    expect(catStyler(theme, "critical")?.("cat")).toBe("<error>cat</error>");
  });
});
