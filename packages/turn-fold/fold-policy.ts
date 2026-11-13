export type FoldPolicy = Readonly<{
  /** Collapse a finished turn into one settled summary row that begins with `Worked for`. */
  foldSettledTurns: boolean;
  /** Activity rows a running turn keeps visible. `Infinity` keeps every one of them. */
  visibleActivityLimit: number;
}>;

// The owner wants every activity of a running turn on screen, so nothing is folded away while the
// turn streams, and the owner wants a finished turn to stay open. A finite `visibleActivityLimit`
// brings the newest-N behavior back, and `foldSettledTurns` brings the settled fold back.
export const FOLD_POLICY: FoldPolicy = {
  foldSettledTurns: false,
  visibleActivityLimit: Number.POSITIVE_INFINITY,
};

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

function settledOpenDisplay(input: FoldDisplayInput): FoldDisplay {
  // Every row of a finished turn keeps its native rendering. Rows that no activity backs, such as
  // the duplicate live compaction row, stay hidden.
  const keepsRow = input.isSettledSummaryAnchor || input.isFinalAnchor || input.isRecentActivity;
  return keepsRow ? "original" : "hidden";
}

function settledFoldedDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.isSettledSummaryAnchor && input.isFinalAnchor) return "settled-summary-final";
  if (input.isSettledSummaryAnchor) return "settled-summary";
  return input.isFinalAnchor ? "settled-final" : "hidden";
}

export function foldDisplay(input: FoldDisplayInput): FoldDisplay {
  if (input.settled)
    return FOLD_POLICY.foldSettledTurns ? settledFoldedDisplay(input) : settledOpenDisplay(input);
  if (input.isRecentActivity) return "original";
  return input.isStreamingSummaryAnchor ? "streaming-summary" : "hidden";
}
