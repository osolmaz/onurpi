import type { TurnFoldMode } from "./mode.ts";

export type FoldDisplay = "hidden" | "history" | "original" | "summary";

export type FoldDisplayInput = {
  aborted: boolean;
  isAnchor: boolean;
  isFinalAssistant: boolean;
  mode: TurnFoldMode;
  settled: boolean;
};

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.mode === "expanded") return "original";
  if (!input.settled && input.mode === "live") return "original";
  if (input.settled && input.isFinalAssistant && !input.aborted) return "original";
  return input.isAnchor ? "summary" : "hidden";
}
