import { describe, expect, it } from "vitest";

import { createPermissionState, setEnabled, toggle } from "./state.ts";

describe("permission state", () => {
  it("starts with the given switch", () => {
    expect(createPermissionState(true)).toEqual({ enabled: true });
  });

  it("sets and toggles the switch", () => {
    const state = createPermissionState(true);
    setEnabled(state, false);
    expect(state.enabled).toBe(false);
    expect(toggle(state)).toBe(true);
    expect(toggle(state)).toBe(false);
    expect(state.enabled).toBe(false);
  });
});
