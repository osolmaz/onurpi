import type { TurnFoldMode } from "./mode.ts";

export type FoldDisplay = "hidden" | "history" | "original" | "summary";

export type FoldDisplayInput = {
  aborted: boolean;
  isAnchor: boolean;
  isFinalAssistant: boolean;
  isRecentActivity: boolean;
  mode: TurnFoldMode;
  settled: boolean;
};

function runningLiveDisplay(isRecentActivity: boolean): FoldDisplay {
  return isRecentActivity ? "original" : "hidden";
}

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.mode === "expanded") return "original";
  if (!input.settled && input.mode === "live") {
    return runningLiveDisplay(input.isRecentActivity);
  }
  if (input.settled && input.isFinalAssistant && !input.aborted) return "original";
  return input.isAnchor ? "summary" : "hidden";
}
