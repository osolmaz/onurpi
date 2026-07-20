import { describe, expect, it } from "vitest";

import { isTurnFoldMode, nextTurnFoldMode, TURN_FOLD_MODES } from "./mode.ts";

describe("turn fold modes", () => {
  it("recognizes only compact and expanded modes", () => {
    expect(TURN_FOLD_MODES).toEqual(["compact", "expanded"]);
    expect(isTurnFoldMode("compact")).toBe(true);
    expect(isTurnFoldMode("expanded")).toBe(true);
    expect(isTurnFoldMode("live")).toBe(false);
  });

  it("toggles between both modes", () => {
    expect(nextTurnFoldMode("compact")).toBe("expanded");
    expect(nextTurnFoldMode("expanded")).toBe("compact");
  });
});
