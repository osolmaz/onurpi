import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import { decodePlanSnapshot, type PlanSnapshot, UPDATE_PLAN_TOOL_NAME } from "./plan-schema.ts";

export type ReplayedPlan = Readonly<{
  snapshot?: PlanSnapshot;
  sourceTimestamp?: number;
}>;

type ReplayUpdate = Readonly<{
  snapshot?: PlanSnapshot;
  sourceTimestamp?: number;
}>;

function replayUpdate(entry: SessionEntry): ReplayUpdate | undefined {
  if (entry.type !== "message") return undefined;
  const message = entry.message;
  if (message.role !== "toolResult") return undefined;
  if (message.toolName !== UPDATE_PLAN_TOOL_NAME || message.isError) return undefined;
  const snapshot = decodePlanSnapshot(message.details);
  if (!snapshot) return undefined;
  if (snapshot.plan.length === 0) return Object.freeze({});
  return Object.freeze({ snapshot, sourceTimestamp: message.timestamp });
}

export function replayPlanSnapshot(entries: readonly SessionEntry[]): ReplayedPlan {
  let current: ReplayUpdate = Object.freeze({});
  for (const entry of entries) {
    const update = replayUpdate(entry);
    if (update) current = update;
  }
  return current;
}
