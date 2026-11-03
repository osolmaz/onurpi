import { describe, expect, it } from "vitest";

import { createGateState } from "./gate-state.ts";
import { decide, NO_UI_REASON, sendsInput, type GateDecisionInput } from "./policy.ts";

function gateInput(overrides: Partial<GateDecisionInput> = {}): GateDecisionInput {
  return {
    state: createGateState(true),
    toolName: "write",
    input: { path: "notes.txt" },
    hints: undefined,
    hasUI: true,
    ...overrides,
  };
}

describe("decide", () => {
  it("passes every call while the gate is off", () => {
    const input = gateInput({ state: createGateState(false) });
    expect(decide(input)).toEqual({ action: "pass" });
  });

  it("asks before a call that writes", () => {
    expect(decide(gateInput())).toEqual({ action: "ask" });
  });

  it("passes a local read", () => {
    expect(decide(gateInput({ toolName: "read", input: { path: "a.txt" } }))).toEqual({
      action: "pass",
    });
  });

  it("passes a tool that declares readOnlyHint", () => {
    expect(decide(gateInput({ toolName: "clip", hints: { readOnlyHint: true } }))).toEqual({
      action: "pass",
    });
  });

  it("gates a local read that declares readOnlyHint false", () => {
    expect(decide(gateInput({ toolName: "read", hints: { readOnlyHint: false } }))).toEqual({
      action: "ask",
    });
  });

  it("gates a local read that declares destructiveHint", () => {
    expect(decide(gateInput({ toolName: "read", hints: { destructiveHint: true } }))).toEqual({
      action: "ask",
    });
  });

  it("gates a call that reaches the network", () => {
    expect(
      decide(gateInput({ toolName: "fetch_content", input: { url: "https://x.test" } })),
    ).toEqual({ action: "ask" });
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

  it("passes local reads without a UI", () => {
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
