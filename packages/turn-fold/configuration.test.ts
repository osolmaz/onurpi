import { describe, expect, it } from "vitest";

import {
  configurationFromBranch,
  DEFAULT_TURN_FOLD_CONFIGURATION,
  isTurnFoldConfiguration,
  TURN_FOLD_CONFIG_ENTRY,
} from "./configuration.ts";

function config(data: unknown) {
  return { customType: TURN_FOLD_CONFIG_ENTRY, data, type: "custom" };
}

describe("Turn Fold configuration", () => {
  it("validates the complete configuration shape", () => {
    expect(isTurnFoldConfiguration({ mode: "compact", windows: 3 })).toBe(true);
    expect(isTurnFoldConfiguration({ mode: "expanded", windows: "all" })).toBe(true);
    expect(isTurnFoldConfiguration({ mode: "compact" })).toBe(false);
    expect(isTurnFoldConfiguration({ mode: "old", windows: 3 })).toBe(false);
    expect(isTurnFoldConfiguration({ mode: "compact", windows: 0 })).toBe(false);
    expect(isTurnFoldConfiguration(null)).toBe(false);
  });

  it("uses the latest valid active-branch entry", () => {
    expect(
      configurationFromBranch([
        config({ mode: "compact", windows: 2 }),
        config({ mode: "expanded", windows: "all" }),
      ]),
    ).toEqual({ mode: "expanded", windows: "all" });
  });

  it("ignores unrelated, malformed, and superseded config entries", () => {
    expect(
      configurationFromBranch([
        config({ mode: "expanded", windows: 5 }),
        { customType: "other", data: { mode: "compact", windows: 1 }, type: "custom" },
        config({ mode: "compact" }),
        undefined,
      ]),
    ).toEqual({ mode: "expanded", windows: 5 });
    expect(configurationFromBranch([])).toEqual(DEFAULT_TURN_FOLD_CONFIGURATION);
  });
});
