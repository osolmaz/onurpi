import type { ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
  applyBashTimeoutPolicy,
  DEFAULT_BASH_TIMEOUT_SECONDS,
  enforceBashToolCallTimeout,
  MAX_BASH_TIMEOUT_SECONDS,
} from "./bash-timeout-policy.ts";

function bashEvent(timeout?: number): ToolCallEvent {
  return {
    type: "tool_call",
    toolCallId: "bash-call",
    toolName: "bash",
    input: {
      command: "printf safe",
      ...(timeout === undefined ? {} : { timeout }),
    },
  };
}

describe("bash timeout policy", () => {
  it("injects the Codex-compatible default when timeout is omitted", () => {
    const event = bashEvent();

    expect(enforceBashToolCallTimeout(event)).toEqual({
      action: "defaulted",
      timeout: DEFAULT_BASH_TIMEOUT_SECONDS,
    });
    expect(event.input).toEqual({ command: "printf safe", timeout: 10 });
  });

  it("preserves valid explicit timeouts through the hard limit", () => {
    for (const timeout of [0.25, 10, MAX_BASH_TIMEOUT_SECONDS]) {
      const input = { timeout };
      expect(applyBashTimeoutPolicy(input)).toEqual({ action: "preserved", timeout });
      expect(input.timeout).toBe(timeout);
    }
  });

  it("caps explicit timeouts above the hard limit", () => {
    const event = bashEvent(8_352);

    expect(enforceBashToolCallTimeout(event)).toEqual({
      action: "capped",
      timeout: MAX_BASH_TIMEOUT_SECONDS,
    });
    expect(event.input).toEqual({ command: "printf safe", timeout: 120 });
  });

  it("leaves invalid explicit values for Pi's built-in validator to reject", () => {
    for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const input = { timeout };
      expect(applyBashTimeoutPolicy(input)).toEqual({ action: "preserved", timeout });
      expect(input.timeout).toBe(timeout);
    }
  });

  it("ignores non-bash tool calls", () => {
    const event: ToolCallEvent = {
      type: "tool_call",
      toolCallId: "read-call",
      toolName: "read",
      input: { path: "README.md" },
    };

    expect(enforceBashToolCallTimeout(event)).toBeUndefined();
    expect(event.input).toEqual({ path: "README.md" });
  });

  it("is idempotent when multiple policy passes see the same call", () => {
    const defaulted = bashEvent();
    expect(enforceBashToolCallTimeout(defaulted)?.action).toBe("defaulted");
    expect(enforceBashToolCallTimeout(defaulted)?.action).toBe("preserved");
    expect(defaulted.input).toEqual({ command: "printf safe", timeout: 10 });

    const capped = bashEvent(8_352);
    expect(enforceBashToolCallTimeout(capped)?.action).toBe("capped");
    expect(enforceBashToolCallTimeout(capped)?.action).toBe("preserved");
    expect(capped.input).toEqual({ command: "printf safe", timeout: 120 });
  });
});
