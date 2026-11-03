import { describe, expect, it } from "vitest";

import { createPermissionState } from "./state.ts";
import { decide, NO_UI_REASON, sendsInput, type DecisionInput } from "./policy.ts";

function callInput(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    state: createPermissionState(true),
    toolName: "write",
    input: { path: "notes.txt" },
    hints: undefined,
    hasUI: true,
    ...overrides,
  };
}

describe("decide", () => {
  it("passes every call while the check is off", () => {
    const input = callInput({ state: createPermissionState(false) });
    expect(decide(input)).toEqual({ action: "pass" });
  });

  it("asks before a call that writes", () => {
    expect(decide(callInput())).toEqual({ action: "ask" });
  });

  it("passes a local read", () => {
    expect(decide(callInput({ toolName: "read", input: { path: "a.txt" } }))).toEqual({
      action: "pass",
    });
  });

  it("passes a tool that declares a closed, read-only domain", () => {
    expect(
      decide(callInput({ toolName: "clip", hints: { readOnlyHint: true, openWorldHint: false } })),
    ).toEqual({ action: "pass" });
  });

  it("asks when a read-only tool leaves its domain unknown", () => {
    expect(decide(callInput({ toolName: "clip", hints: { readOnlyHint: true } }))).toEqual({
      action: "ask",
    });
  });

  it("asks when a read-only tool declares an open world", () => {
    expect(
      decide(callInput({ toolName: "clip", hints: { readOnlyHint: true, openWorldHint: true } })),
    ).toEqual({ action: "ask" });
  });

  it("checks a tool that declares openWorldHint and nothing else", () => {
    expect(decide(callInput({ toolName: "clip", hints: { openWorldHint: true } }))).toEqual({
      action: "ask",
    });
  });

  it("checks a local read that declares destructiveHint", () => {
    expect(decide(callInput({ toolName: "read", hints: { destructiveHint: true } }))).toEqual({
      action: "ask",
    });
  });

  it("checks a local read that declares readOnlyHint false", () => {
    expect(
      decide(callInput({ toolName: "read", hints: { readOnlyHint: false, openWorldHint: false } })),
    ).toEqual({ action: "ask" });
  });

  it("checks a call that reaches the network", () => {
    expect(
      decide(callInput({ toolName: "fetch_content", input: { url: "https://x.test" } })),
    ).toEqual({ action: "ask" });
  });

  it("passes a write_stdin poll", () => {
    const input = callInput({ toolName: "write_stdin", input: { session_id: 3 } });
    expect(decide(input)).toEqual({ action: "pass" });
  });

  it("asks for write_stdin input", () => {
    const input = callInput({ toolName: "write_stdin", input: { session_id: 3, chars: "y\r" } });
    expect(decide(input)).toEqual({ action: "ask" });
  });

  it("blocks instead of asking when there is no interactive UI", () => {
    expect(decide(callInput({ hasUI: false }))).toEqual({ action: "block", reason: NO_UI_REASON });
    expect(NO_UI_REASON).toContain("/permissions off");
  });

  it("passes local reads without a UI", () => {
    expect(decide(callInput({ hasUI: false, toolName: "read" }))).toEqual({ action: "pass" });
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
