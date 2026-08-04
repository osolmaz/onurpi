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
  it("validates the complete strict configuration shape", () => {
    expect(isTurnFoldConfiguration({ density: "compact", preCompaction: "show", windows: 3 })).toBe(
      true,
    );
    expect(
      isTurnFoldConfiguration({
        density: "expanded",
        preCompaction: "hide",
        windows: "all",
      }),
    ).toBe(true);
    expect(isTurnFoldConfiguration({ density: "compact", windows: 3 })).toBe(false);
    expect(
      isTurnFoldConfiguration({
        density: "compact",
        extra: true,
        preCompaction: "show",
        windows: 3,
      }),
    ).toBe(false);
    expect(isTurnFoldConfiguration({ density: "old", preCompaction: "show", windows: 3 })).toBe(
      false,
    );
    expect(isTurnFoldConfiguration({ density: "compact", preCompaction: "old", windows: 3 })).toBe(
      false,
    );
    expect(isTurnFoldConfiguration({ density: "compact", preCompaction: "show", windows: 0 })).toBe(
      false,
    );
    expect(isTurnFoldConfiguration(null)).toBe(false);
  });

  it("uses the latest valid active-branch entry", () => {
    expect(
      configurationFromBranch([
        config({ density: "compact", preCompaction: "show", windows: 2 }),
        config({ density: "expanded", preCompaction: "hide", windows: "all" }),
      ]),
    ).toEqual({ density: "expanded", preCompaction: "hide", windows: "all" });
  });

  it("ignores unrelated, malformed, and superseded config entries", () => {
    expect(
      configurationFromBranch([
        config({ density: "expanded", preCompaction: "show", windows: 5 }),
        {
          customType: "other",
          data: { density: "compact", preCompaction: "hide", windows: 1 },
          type: "custom",
        },
        config({ density: "compact", windows: "all" }),
        undefined,
      ]),
    ).toEqual({ density: "expanded", preCompaction: "show", windows: 5 });
    expect(configurationFromBranch([])).toEqual({
      density: "compact",
      preCompaction: "show",
      windows: "all",
    });
    expect(configurationFromBranch([])).toEqual(DEFAULT_TURN_FOLD_CONFIGURATION);
  });
});
