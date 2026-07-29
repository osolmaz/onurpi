import { normalizeGoalState, type GoalState } from "./goal-state.ts";

export const GOAL_STATE_ENTRY = "pi-goal";

export type RestoredGoalState = {
  goal: GoalState | null;
  statusBarEnabled: boolean;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoredFromData(value: unknown): RestoredGoalState | undefined {
  if (!isRecord(value)) return undefined;
  const rawGoal = value["goal"];
  const goal = rawGoal === null ? null : normalizeGoalState(rawGoal);
  if (goal === undefined) return undefined;
  const statusBarEnabled = value["statusBarEnabled"];
  if (statusBarEnabled !== undefined && typeof statusBarEnabled !== "boolean") return undefined;
  return { goal, statusBarEnabled: statusBarEnabled ?? true };
}

export function latestGoalState(entries: readonly unknown[]): RestoredGoalState {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      !isRecord(entry) ||
      entry["type"] !== "custom" ||
      entry["customType"] !== GOAL_STATE_ENTRY
    ) {
      continue;
    }
    const restored = restoredFromData(entry["data"]);
    if (restored) return restored;
  }
  return { goal: null, statusBarEnabled: true };
}
