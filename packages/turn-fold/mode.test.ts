import { describe, expect, it } from "vitest";

import { isTurnFoldMode, nextTurnFoldMode, TURN_FOLD_MODES } from "./mode.ts";

describe("turn fold modes", () => {
  it("recognizes supported modes", () => {
    expect(TURN_FOLD_MODES).toEqual(["final-only", "live", "expanded"]);
    expect(isTurnFoldMode("live")).toBe(true);
    expect(isTurnFoldMode("unknown")).toBe(false);
  });

  it("cycles through every mode", () => {
    expect(nextTurnFoldMode("final-only")).toBe("live");
    expect(nextTurnFoldMode("live")).toBe("expanded");
    expect(nextTurnFoldMode("expanded")).toBe("final-only");
  });
});
