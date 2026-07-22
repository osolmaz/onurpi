import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { addPlanContextBridge, contextContainsPlan, formatPlanContext } from "./plan-context.ts";
import { decodePlanSnapshot, type PlanSnapshot } from "./plan-schema.ts";
import type { PlanStateView } from "./plan-state.ts";

type ContextMessage = ContextEvent["messages"][number];

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type PopulatedPlanState = PlanStateView & Readonly<{ snapshot: PlanSnapshot }>;

function planState(
  status: "pending" | "in_progress" | "completed" = "in_progress",
): PopulatedPlanState {
  const snapshot = decodePlanSnapshot({ plan: [{ step: "Implement", status }] });
  if (!snapshot) throw new Error("Expected valid fixture");
  return { revision: 1, snapshot, sourceTimestamp: 123 };
}

function assistantCall(toolCallId: string, status = "in_progress"): ContextMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: toolCallId,
        name: "update_plan",
        arguments: { plan: [{ step: "Implement", status }] },
      },
    ],
    api: "test",
    provider: "test",
    model: "test",
    usage: USAGE,
    stopReason: "toolUse",
    timestamp: 10,
  };
}

function toolResult(
  toolCallId: string,
  status = "in_progress",
  options: { error?: boolean; details?: unknown } = {},
): ContextMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "update_plan",
    content: [{ type: "text", text: options.error ? "Rejected" : "Plan updated" }],
    details: options.details ?? { plan: [{ step: "Implement", status }] },
    isError: options.error ?? false,
    timestamp: 11,
  };
}

describe("plan context continuity", () => {
  it("does not inject when the current successful call and result are visible", () => {
    const state = planState();
    const messages = [assistantCall("call-1"), toolResult("call-1")];

    expect(contextContainsPlan(messages, state.snapshot)).toBe(true);
    expect(addPlanContextBridge(messages, state)).toBe(messages);
  });

  it("injects stable hidden state after the current plan leaves context", () => {
    const state = planState();
    const messages: ContextMessage[] = [];
    const first = addPlanContextBridge(messages, state);
    const second = addPlanContextBridge(messages, state);

    expect(first).not.toBe(messages);
    expect(first).toEqual(second);
    expect(first.at(-1)).toEqual({
      role: "custom",
      customType: "plan-checklist-current",
      content: formatPlanContext(state.snapshot),
      display: false,
      timestamp: 123,
    });
  });

  it("injects for failed, mismatched, and stale visible updates", () => {
    const state = planState();
    const cases = [
      [assistantCall("failed"), toolResult("failed", "in_progress", { error: true })],
      [assistantCall("mismatch"), toolResult("mismatch", "completed")],
      [assistantCall("stale", "pending"), toolResult("stale", "pending")],
      [toolResult("orphan")],
      [
        assistantCall("malformed"),
        toolResult("malformed", "in_progress", { details: { plan: "invalid" } }),
      ],
    ];

    for (const messages of cases) {
      expect(addPlanContextBridge(messages, state)).toHaveLength(messages.length + 1);
    }
  });

  it("does nothing without a current non-empty snapshot", () => {
    const messages = [assistantCall("call-1"), toolResult("call-1")];
    expect(addPlanContextBridge(messages, { revision: 0 })).toBe(messages);
  });
});
