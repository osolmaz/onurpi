export type EditDiffStat = {
  additions: number;
  deletions: number;
  path: string;
};

export type EditDiffSummary = {
  additions: number;
  deletions: number;
  files: number;
};

type HunkCounts = {
  newLines: number;
  oldLines: number;
};

type PatchState = {
  additions: number;
  consumed: HunkCounts;
  deletions: number;
  expected?: HunkCounts;
  newPath?: string;
  oldPath?: string;
  sawHunk: boolean;
};

const HUNK_HEADER = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@(?: .*)?$/u;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : undefined;
}

function headerPath(line: string, prefix: "--- " | "+++ "): string | undefined {
  if (!line.startsWith(prefix)) return undefined;
  const [value] = line.slice(prefix.length).split("\t", 1);
  return value?.length ? value : undefined;
}

function parsedLineCount(value: string | undefined): number | undefined {
  const count = Number(value ?? 1);
  return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

function hunkCounts(line: string): HunkCounts | undefined {
  const match = HUNK_HEADER.exec(line);
  if (!match) return undefined;
  const oldLines = parsedLineCount(match[1]);
  const newLines = parsedLineCount(match[2]);
  return oldLines === undefined || newLines === undefined ? undefined : { oldLines, newLines };
}

function hunkIsComplete(expected: HunkCounts, consumed: HunkCounts): boolean {
  return expected.oldLines === consumed.oldLines && expected.newLines === consumed.newLines;
}

function beginHunk(state: PatchState, expected: HunkCounts): boolean {
  if (state.expected && !hunkIsComplete(state.expected, state.consumed)) return false;
  state.expected = expected;
  state.consumed = { oldLines: 0, newLines: 0 };
  state.sawHunk = true;
  return true;
}

function capturePatchHeader(state: PatchState, line: string): void {
  const oldPath = headerPath(line, "--- ");
  const newPath = headerPath(line, "+++ ");
  if (oldPath) state.oldPath ??= oldPath;
  if (newPath) state.newPath ??= newPath;
}

type HunkLineDelta = HunkCounts & { addition: boolean; deletion: boolean };

function lineDelta(line: string): HunkLineDelta | undefined {
  if (line.startsWith(" ")) {
    return { addition: false, deletion: false, oldLines: 1, newLines: 1 };
  }
  if (line.startsWith("-")) {
    return { addition: false, deletion: true, oldLines: 1, newLines: 0 };
  }
  if (line.startsWith("+")) {
    return { addition: true, deletion: false, oldLines: 0, newLines: 1 };
  }
  return undefined;
}

function isHunkTrailer(
  line: string,
  isFinalLine: boolean,
  expected: HunkCounts,
  consumed: HunkCounts,
): boolean {
  return (
    line === "\\ No newline at end of file" ||
    (line === "" && isFinalLine && hunkIsComplete(expected, consumed))
  );
}

function consumeHunkLine(state: PatchState, line: string, isFinalLine: boolean): boolean {
  const expected = state.expected;
  if (!expected) return false;
  if (isHunkTrailer(line, isFinalLine, expected, state.consumed)) return true;

  const delta = lineDelta(line);
  if (!delta) return false;
  state.consumed.oldLines += delta.oldLines;
  state.consumed.newLines += delta.newLines;
  if (delta.deletion) state.deletions += 1;
  if (delta.addition) state.additions += 1;
  return (
    state.consumed.oldLines <= expected.oldLines && state.consumed.newLines <= expected.newLines
  );
}

function consumePatchLine(state: PatchState, line: string, isFinalLine: boolean): boolean {
  const nextHunk = hunkCounts(line);
  if (nextHunk) return beginHunk(state, nextHunk);
  if (!state.expected) {
    capturePatchHeader(state, line);
    return true;
  }
  return consumeHunkLine(state, line, isFinalLine);
}

function completedPath(state: PatchState): string | undefined {
  if (!state.sawHunk || !state.oldPath || !state.newPath) return undefined;
  return state.oldPath === state.newPath ? state.newPath : undefined;
}

function completedStat(state: PatchState): EditDiffStat | undefined {
  if (!state.expected || !hunkIsComplete(state.expected, state.consumed)) return undefined;
  const path = completedPath(state);
  if (!path || (state.additions === 0 && state.deletions === 0)) return undefined;
  return { additions: state.additions, deletions: state.deletions, path };
}

export function parseEditPatch(patch: string): EditDiffStat | undefined {
  const lines = patch.replaceAll("\r\n", "\n").split("\n");
  const state: PatchState = {
    additions: 0,
    consumed: { oldLines: 0, newLines: 0 },
    deletions: 0,
    sawHunk: false,
  };
  const accepted = lines.every((line, index) =>
    consumePatchLine(state, line, index === lines.length - 1),
  );
  return accepted ? completedStat(state) : undefined;
}

export function editDiffFromToolResult(
  message: unknown,
): { stat: EditDiffStat; toolCallId: string } | undefined {
  if (stringField(message, "role") !== "toolResult") return undefined;
  if (stringField(message, "toolName") !== "edit") return undefined;
  if (!isRecord(message) || message["isError"] !== false) return undefined;
  const toolCallId = stringField(message, "toolCallId");
  const patch = stringField(message["details"], "patch");
  if (!toolCallId || !patch) return undefined;
  const stat = parseEditPatch(patch);
  return stat ? { stat, toolCallId } : undefined;
}

export class TurnEditDiffs {
  private additions = 0;
  private byToolCallId = new Map<string, EditDiffStat>();
  private deletions = 0;
  private files = new Set<string>();

  add(toolCallId: string, stat: EditDiffStat): boolean {
    if (this.byToolCallId.has(toolCallId)) return false;
    this.byToolCallId.set(toolCallId, stat);
    this.additions += stat.additions;
    this.deletions += stat.deletions;
    this.files.add(stat.path);
    return true;
  }

  merge(other: TurnEditDiffs): void {
    for (const [toolCallId, stat] of other.byToolCallId) this.add(toolCallId, stat);
  }

  summary(): EditDiffSummary | undefined {
    return this.byToolCallId.size > 0
      ? { additions: this.additions, deletions: this.deletions, files: this.files.size }
      : undefined;
  }
}
