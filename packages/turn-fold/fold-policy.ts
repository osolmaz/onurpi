// The owner wants every activity of a running turn on screen, so nothing is folded away while
// the turn streams. Set this to a finite count to bring the newest-N behavior back.
export const VISIBLE_ACTIVITY_LIMIT = Number.POSITIVE_INFINITY;

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
  settled: boolean;
};

function settledDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.isSettledSummaryAnchor && input.isFinalAnchor) return "settled-summary-final";
  if (input.isSettledSummaryAnchor) return "settled-summary";
  return input.isFinalAnchor ? "settled-final" : "hidden";
}

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.settled) return settledDisplay(input);
  if (input.isRecentActivity) return "original";
  return input.isStreamingSummaryAnchor ? "streaming-summary" : "hidden";
}
