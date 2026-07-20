import type { TurnFoldMode } from "./mode.ts";

export type FoldDisplay =
  | "hidden"
  | "original"
  | "settled-final"
  | "settled-summary"
  | "settled-summary-final"
  | "streaming-summary";

export type FoldDisplayInput = {
  isFinalAnchor: boolean;
  isRecentActivity: boolean;
  isSettledSummaryAnchor: boolean;
  isStreamingSummaryAnchor: boolean;
  mode: TurnFoldMode;
  settled: boolean;
};

function settledDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.isSettledSummaryAnchor && input.isFinalAnchor) return "settled-summary-final";
  if (input.isSettledSummaryAnchor) return "settled-summary";
  return input.isFinalAnchor ? "settled-final" : "hidden";
}

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.mode === "expanded") return "original";
  if (input.settled) return settledDisplay(input);
  if (input.isRecentActivity) return "original";
  return input.isStreamingSummaryAnchor ? "streaming-summary" : "hidden";
}
