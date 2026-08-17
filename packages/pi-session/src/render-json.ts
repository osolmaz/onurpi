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
  let removedDetails = false;
  let candidate = recoveryCandidate(document, turns, issues, removedTurns, removedDetails);

  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && turns.length > 1) {
    turns = turns.slice(1);
    removedTurns += 1;
    candidate = recoveryCandidate(document, turns, issues, removedTurns, true);
  }
  while (
    jsonBytes(candidate) > TOTAL_OUTPUT_BYTES &&
    turns.some((turn) => turn.control.length > 0)
  ) {
    turns = removeOldestControl(turns);
    removedDetails = true;
    candidate = recoveryCandidate(document, turns, issues, removedTurns, removedDetails);
  }
  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && issues.length > 0) {
    issues = issues.slice(0, -1);
    removedDetails = true;
    candidate = recoveryCandidate(document, turns, issues, removedTurns, removedDetails);
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
  let candidate: SessionListDocument = { ...document, sessions };
  while (jsonBytes(candidate) > TOTAL_OUTPUT_BYTES && sessions.length > 0) {
    sessions = sessions.slice(0, -1);
    candidate = { ...document, sessions };
  }
  return stringify(candidate);
}

function recoveryCandidate(
  source: RecoveryDocument,
  turns: readonly TurnEvidence[],
  issues: readonly IntegrityIssue[],
  removedTurns: number,
  removedDetails: boolean,
): RecoveryDocument {
  const omittedTurns = source.selection.omittedTurns + removedTurns;
  return {
    ...source,
    integrity: { status: source.integrity.status, issues },
    selection: {
      ...source.selection,
      selectedTurns: turns.length,
      omittedTurns,
      outputTruncated: source.selection.outputTruncated || removedTurns > 0 || removedDetails,
    },
    turns,
    nextOffset: omittedTurns > 0 ? omittedTurns : null,
  };
}

function entryCandidate(source: EntryDocument, issues: readonly IntegrityIssue[]): EntryDocument {
  return {
    ...source,
    integrity: { status: source.integrity.status, issues },
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
