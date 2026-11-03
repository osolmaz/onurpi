import { describe, expect, it } from "vitest";

import {
  allowToolForSession,
  approveCall,
  createGateState,
  MAX_APPROVED_CALLS,
  resetSession,
  setGateEnabled,
  toggleGate,
} from "./gate-state.ts";

describe("gate state", () => {
  it("starts with the given switch and no approvals", () => {
    const state = createGateState(true);
    expect(state.enabled).toBe(true);
    expect(state.allowedTools.size).toBe(0);
    expect(state.approvedCalls.size).toBe(0);
  });

  it("sets and toggles the switch", () => {
    const state = createGateState(true);
    setGateEnabled(state, false);
    expect(state.enabled).toBe(false);
    expect(toggleGate(state)).toBe(true);
    expect(toggleGate(state)).toBe(false);
    expect(state.enabled).toBe(false);
  });

  it("remembers a tool and a call", () => {
    const state = createGateState(true);
    allowToolForSession(state, "bash");
    approveCall(state, "call-1");
    expect([...state.allowedTools]).toEqual(["bash"]);
    expect([...state.approvedCalls]).toEqual(["call-1"]);
  });

  it("forgets both kinds of approval when a session changes", () => {
    const state = createGateState(false);
    allowToolForSession(state, "bash");
    approveCall(state, "call-1");
    resetSession(state);
    expect(state.allowedTools.size).toBe(0);
    expect(state.approvedCalls.size).toBe(0);
    expect(state.enabled).toBe(false);
  });

  it("keeps the approval set bounded", () => {
    const state = createGateState(true);
    const count = MAX_APPROVED_CALLS + 10;
    for (let index = 0; index < count; index += 1) approveCall(state, "call-" + String(index));
    expect(state.approvedCalls.size).toBe(MAX_APPROVED_CALLS);
    expect(state.approvedCalls.has("call-0")).toBe(false);
    expect(state.approvedCalls.has("call-" + String(count - 1))).toBe(true);
  });
});
