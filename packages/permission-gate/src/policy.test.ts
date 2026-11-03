import { describe, expect, it } from "vitest";

import { createGateState } from "./gate-state.ts";
import { decide, NO_UI_REASON, sendsInput, type GateDecisionInput } from "./policy.ts";

function gateInput(overrides: Partial<GateDecisionInput> = {}): GateDecisionInput {
  return {
    state: createGateState(true),
    toolName: "write",
    input: { path: "notes.txt" },
    readOnlyHint: undefined,
    parentToolCallId: undefined,
    hasUI: true,
    ...overrides,
  };
}

describe("decide", () => {
  it("passes every call while the gate is off", () => {
    const input = gateInput({ state: createGateState(false) });
    expect(decide(input)).toEqual({ action: "pass" });
  });

  it("asks before a call that changes state", () => {
    expect(decide(gateInput())).toEqual({ action: "ask" });
  });

  it("passes a listed read-only tool", () => {
    expect(decide(gateInput({ toolName: "read", input: { path: "a.txt" } }))).toEqual({
      action: "pass",
    });
  });

  it("passes a tool that declares readOnlyHint", () => {
    expect(decide(gateInput({ toolName: "clip", readOnlyHint: true }))).toEqual({ action: "pass" });
  });

  it("still asks when readOnlyHint is false or missing", () => {
    expect(decide(gateInput({ toolName: "clip", readOnlyHint: false }))).toEqual({ action: "ask" });
    expect(decide(gateInput({ toolName: "clip", readOnlyHint: undefined }))).toEqual({
      action: "ask",
    });
  });

  it("passes a tool the user allowed for the session", () => {
    const state = createGateState(true);
    state.allowedTools.add("bash");
    expect(decide(gateInput({ state, toolName: "bash", input: { command: "ls" } }))).toEqual({
      action: "pass",
    });
  });

  it("passes a nested call inside an approved parent call", () => {
    const state = createGateState(true);
    state.approvedCalls.add("call-1");
    expect(decide(gateInput({ state, parentToolCallId: "call-1" }))).toEqual({ action: "pass" });
  });

  it("asks for a nested call with an unknown parent", () => {
    const state = createGateState(true);
    state.approvedCalls.add("call-1");
    expect(decide(gateInput({ state, parentToolCallId: "call-2" }))).toEqual({ action: "ask" });
  });

  it("passes a write_stdin poll", () => {
    const input = gateInput({ toolName: "write_stdin", input: { session_id: 3 } });
    expect(decide(input)).toEqual({ action: "pass" });
  });

  it("asks for write_stdin input", () => {
    const input = gateInput({ toolName: "write_stdin", input: { session_id: 3, chars: "y\r" } });
    expect(decide(input)).toEqual({ action: "ask" });
  });

  it("blocks instead of asking when there is no interactive UI", () => {
    expect(decide(gateInput({ hasUI: false }))).toEqual({ action: "block", reason: NO_UI_REASON });
  });

  it("passes read-only calls without a UI", () => {
    expect(decide(gateInput({ hasUI: false, toolName: "read" }))).toEqual({ action: "pass" });
  });
});

describe("sendsInput", () => {
  it("detects text and base64 input", () => {
    expect(sendsInput({ chars: "x" })).toBe(true);
    expect(sendsInput({ chars_b64: "eA==" })).toBe(true);
    expect(sendsInput({ chars: "" })).toBe(false);
    expect(sendsInput({ session_id: 1 })).toBe(false);
  });
});
