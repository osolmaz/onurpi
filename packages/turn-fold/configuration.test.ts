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
  it("validates the strict compact-scope configuration shape", () => {
    expect(isTurnFoldConfiguration({ preCompaction: "show", windows: 3 })).toBe(true);
    expect(isTurnFoldConfiguration({ preCompaction: "hide", windows: "all" })).toBe(true);
    expect(isTurnFoldConfiguration({ windows: 3 })).toBe(false);
    expect(isTurnFoldConfiguration({ extra: true, preCompaction: "show", windows: 3 })).toBe(false);
    expect(isTurnFoldConfiguration({ density: "compact", preCompaction: "show", windows: 3 })).toBe(
      false,
    );
    expect(isTurnFoldConfiguration({ preCompaction: "old", windows: 3 })).toBe(false);
    expect(isTurnFoldConfiguration({ preCompaction: "show", windows: 0 })).toBe(false);
    expect(isTurnFoldConfiguration(null)).toBe(false);
  });

  it("uses the latest valid active-branch entry", () => {
    expect(
      configurationFromBranch([
        config({ preCompaction: "show", windows: 2 }),
        config({ preCompaction: "hide", windows: "all" }),
      ]),
    ).toEqual({ preCompaction: "hide", windows: "all" });
  });

  it("ignores unrelated, malformed, and superseded density entries", () => {
    expect(
      configurationFromBranch([
        config({ preCompaction: "show", windows: 5 }),
        {
          customType: "other",
          data: { preCompaction: "hide", windows: 1 },
          type: "custom",
        },
        config({ density: "compact", preCompaction: "hide", windows: "all" }),
        undefined,
      ]),
    ).toEqual({ preCompaction: "show", windows: 5 });
    expect(configurationFromBranch([])).toEqual({
      preCompaction: "show",
      windows: "all",
    });
    expect(configurationFromBranch([])).toEqual(DEFAULT_TURN_FOLD_CONFIGURATION);
  });
});
