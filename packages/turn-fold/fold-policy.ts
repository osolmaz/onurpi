import type { TurnFoldMode } from "./mode.ts";

export type FoldDisplay = "hidden" | "original" | "settled-final" | "streaming-summary";

export type FoldDisplayInput = {
  isFinalAnchor: boolean;
  isRecentActivity: boolean;
  isStreamingSummaryAnchor: boolean;
  mode: TurnFoldMode;
  settled: boolean;
};

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.mode === "expanded") return "original";
  if (input.settled) return input.isFinalAnchor ? "settled-final" : "hidden";
  if (input.isRecentActivity) return "original";
  return input.isStreamingSummaryAnchor ? "streaming-summary" : "hidden";
}
