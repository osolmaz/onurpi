import type { LoopDecision } from "./loop-detector.ts";

export const LOOP_GUARD_MESSAGE_TYPE = "onurpi-loop-guard";
export const LOOP_GUARD_EVENT = "onurpi:loop-guard";

export type LoopGuardEvent = {
  action: "nudge" | "trip";
  decision: LoopDecision;
  version: 1;
};

function evidence(decision: LoopDecision): string {
  switch (decision.kind) {
    case "exact_cycle":
      return `The same ${String(decision.cycleLength)}-run outcome cycle repeated ${String(decision.repetitions)} times.`;
    case "repeated_error":
      return `The same terminal error occurred ${String(decision.count)} times.`;
    case "continuation_churn":
      return `${String(decision.count)} continuation-led runs had ${String(Math.round(decision.similarity * 100))}% action similarity.`;
    case "episode_checkpoint":
      return `${String(decision.count)} settled runs finished without substantive user direction.`;
    case "turn_checkpoint":
      return `The current run reached ${String(decision.count)} model turns.`;
    case "thinking_repetition":
      return `${String(decision.matchedWindows)} separate ${String(decision.windowTokens)}-token reasoning windows each appeared ${String(decision.occurrences)} times within one response.`;
    case "manual_nudge":
      return "The user requested an immediate loop review.";
  }
}

export function interventionContent(decision: LoopDecision): string {
  return [
    "Loop Guard detected repeated work.",
    "",
    `Evidence: ${evidence(decision)}`,
    "",
    "Stop the current approach. Do not rerun or slightly vary the same experiment.",
    "Before using more tools:",
    "1. Restate the objective and verified facts.",
    "2. Identify repeated actions and claims that were later invalidated.",
    "3. Decide whether the current path is blocked.",
    "4. Choose one materially different next action.",
    "",
    "If no defensible new action exists, stop and ask the user.",
  ].join("\n");
}

export function decisionLabel(decision: LoopDecision): string {
  switch (decision.kind) {
    case "exact_cycle":
      return `repeated ${String(decision.cycleLength)}-run cycle`;
    case "repeated_error":
      return "repeated terminal error";
    case "continuation_churn":
      return "repeated continuation work";
    case "episode_checkpoint":
      return `${String(decision.count)}-run checkpoint`;
    case "turn_checkpoint":
      return `${String(decision.count)}-turn checkpoint`;
    case "thinking_repetition":
      return "repeated streamed reasoning";
    case "manual_nudge":
      return "manual review";
  }
}
