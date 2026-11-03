import { describe, expect, it } from "vitest";

import { createGateState, setGateEnabled, toggleGate } from "./gate-state.ts";

describe("gate state", () => {
  it("starts with the given switch", () => {
    expect(createGateState(true)).toEqual({ enabled: true });
  });

  it("sets and toggles the switch", () => {
    const state = createGateState(true);
    setGateEnabled(state, false);
    expect(state.enabled).toBe(false);
    expect(toggleGate(state)).toBe(true);
    expect(toggleGate(state)).toBe(false);
    expect(state.enabled).toBe(false);
  });
});
