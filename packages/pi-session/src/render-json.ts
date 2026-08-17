import {
  TOTAL_OUTPUT_BYTES,
  type EntryDocument,
  type IntegrityIssue,
  type RecoveryDocument,
  type SessionListDocument,
  type TurnEvidence,
} from "./types.js";

export function renderRecoveryJson(document: RecoveryDocument): string {
  let turns = [...document.turns];
  let issues = [...document.integrity.issues];
  let removedTurns = 0;
  let removedControls = 0;
  let candidate = recoveryCandidate(document, turns, issues, removedTurns, removedControls);

  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && turns.length > 1) {
    turns = turns.slice(1);
    removedTurns += 1;
    candidate = recoveryCandidate(document, turns, issues, removedTurns, removedControls);
  }
  while (
    jsonBytes(candidate) > TOTAL_OUTPUT_BYTES &&
    turns.some((turn) => turn.control.length > 0)
  ) {
    turns = removeOldestControl(turns);
    removedControls += 1;
    candidate = recoveryCandidate(document, turns, issues, removedTurns, removedControls);
  }
  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && issues.length > 0) {
    issues = issues.slice(0, -1);
    candidate = recoveryCandidate(document, turns, issues, removedTurns, removedControls);
  }
  return stringify(candidate);
}

export function renderEntryJson(document: EntryDocument): string {
  let issues = [...document.integrity.issues];
  let candidate = entryCandidate(document, issues);
  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && issues.length > 0) {
    issues = issues.slice(0, -1);
    candidate = entryCandidate(document, issues);
  }
  return stringify(candidate);
}

export function renderListJson(document: SessionListDocument): string {
  let sessions = [...document.sessions];
  let candidate = listCandidate(document, sessions);
  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && sessions.length > 0) {
    sessions = sessions.slice(0, -1);
    candidate = listCandidate(document, sessions);
  }
  return stringify(candidate);
}

function recoveryCandidate(
  source: RecoveryDocument,
  turns: readonly TurnEvidence[],
  issues: readonly IntegrityIssue[],
  removedTurns: number,
  removedControls: number,
): RecoveryDocument {
  const omittedTurns = source.selection.omittedTurns + removedTurns;
  const omittedIssues =
    source.integrity.omittedIssues + source.integrity.issues.length - issues.length;
  return {
    ...source,
    integrity: { status: source.integrity.status, issues, omittedIssues },
    selection: {
      ...source.selection,
      selectedTurns: turns.length,
      omittedTurns,
      omittedControlEvents: source.selection.omittedControlEvents + removedControls,
      outputTruncated:
        source.selection.outputTruncated ||
        removedTurns > 0 ||
        removedControls > 0 ||
        omittedIssues > source.integrity.omittedIssues,
    },
    turns,
    nextOffset: omittedTurns > 0 ? omittedTurns : null,
  };
}

function entryCandidate(source: EntryDocument, issues: readonly IntegrityIssue[]): EntryDocument {
  return {
    ...source,
    integrity: {
      status: source.integrity.status,
      issues,
      omittedIssues:
        source.integrity.omittedIssues + source.integrity.issues.length - issues.length,
    },
  };
}

function listCandidate(
  source: SessionListDocument,
  sessions: SessionListDocument["sessions"],
): SessionListDocument {
  return {
    ...source,
    omittedSessions: source.omittedSessions + source.sessions.length - sessions.length,
    sessions,
  };
}

function removeOldestControl(turns: readonly TurnEvidence[]): TurnEvidence[] {
  let removed = false;
  return turns.map((turn) => {
    if (removed || turn.control.length === 0) return turn;
    removed = true;
    return { ...turn, control: turn.control.slice(1) };
  });
}

function stringify(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonBytes(value: object): number {
  return Buffer.byteLength(stringify(value));
}
