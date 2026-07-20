import type { TurnFoldMode } from "./mode.ts";

export type FoldDisplay = "hidden" | "original";

export type FoldDisplayInput = {
  isLastAssistant: boolean;
  isRecentActivity: boolean;
  mode: TurnFoldMode;
  settled: boolean;
};

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.mode === "expanded") return "original";
  if (!input.settled) return input.isRecentActivity ? "original" : "hidden";
  return input.isLastAssistant ? "original" : "hidden";
}
