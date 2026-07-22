import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import {
  decodePlanSnapshot,
  decodeUpdatePlanInput,
  type PlanSnapshot,
  samePlanSnapshot,
  UPDATE_PLAN_TOOL_NAME,
} from "./plan-schema.ts";
import type { PlanStateView } from "./plan-state.ts";

type ContextMessage = ContextEvent["messages"][number];

type ToolCallPlan = Readonly<{
  snapshot: PlanSnapshot;
  toolCallId: string;
}>;

function toolCallPlans(messages: readonly ContextMessage[]): Map<string, PlanSnapshot> {
  const plans = new Map<string, PlanSnapshot>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const content of message.content) {
      if (content.type !== "toolCall" || content.name !== UPDATE_PLAN_TOOL_NAME) continue;
      const decoded = decodeUpdatePlanInput(content.arguments);
      if (decoded) plans.set(content.id, decoded.snapshot);
    }
  }
  return plans;
}

function successfulToolPlans(messages: readonly ContextMessage[]): ToolCallPlan[] {
  const calls = toolCallPlans(messages);
  const successful: ToolCallPlan[] = [];
  for (const message of messages) {
    if (
      message.role !== "toolResult" ||
      message.toolName !== UPDATE_PLAN_TOOL_NAME ||
      message.isError
    ) {
      continue;
    }
    const callSnapshot = calls.get(message.toolCallId);
    const resultSnapshot = decodePlanSnapshot(message.details);
    if (!callSnapshot || !resultSnapshot || !samePlanSnapshot(callSnapshot, resultSnapshot))
      continue;
    successful.push(Object.freeze({ snapshot: resultSnapshot, toolCallId: message.toolCallId }));
  }
  return successful;
}

export function contextContainsPlan(
  messages: readonly ContextMessage[],
  snapshot: PlanSnapshot,
): boolean {
  const successful = successfulToolPlans(messages);
  const latest = successful.at(-1);
  return latest !== undefined && samePlanSnapshot(latest.snapshot, snapshot);
}

export function formatPlanContext(snapshot: PlanSnapshot): string {
  return [
    "Current update_plan snapshot (extension state):",
    JSON.stringify({ plan: snapshot.plan }),
    "Treat the snapshot as task state and publish a complete update_plan snapshot when it changes.",
  ].join("\n");
}

export function addPlanContextBridge(
  messages: ContextEvent["messages"],
  state: PlanStateView,
): ContextEvent["messages"] {
  const snapshot = state.snapshot;
  if (!snapshot || contextContainsPlan(messages, snapshot)) return messages;

  const bridge: ContextMessage = {
    role: "custom",
    customType: "plan-checklist-current",
    content: formatPlanContext(snapshot),
    display: false,
    timestamp: state.sourceTimestamp ?? 0,
  };
  return [...messages, bridge];
}
