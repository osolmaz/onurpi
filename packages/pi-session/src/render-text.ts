import { formatSize, truncateHead } from "@earendil-works/pi-coding-agent";

import {
  TOTAL_OUTPUT_BYTES,
  type EntryDocument,
  type Excerpt,
  type RecoveryDocument,
  type SessionListDocument,
} from "./types.js";

const OUTPUT_NOTICE_RESERVE = 320;

export function renderRecoveryText(document: RecoveryDocument): string {
  const lines = [
    `Session: ${document.session.id}`,
    `File: ${document.session.file}`,
    `Entries: ${String(document.session.entries)}`,
    `Active branch entries: ${String(document.session.activeBranchEntries)}`,
    `Integrity: ${document.integrity.status}`,
    `Showing: ${String(document.selection.selectedTurns)} of ${String(document.selection.totalTurns)} turns`,
  ];
  if (document.selection.since !== null) lines.push(`Since: ${document.selection.since}`);
  appendIntegrity(lines, document);
  for (const turn of document.turns) appendTurn(lines, turn, document.selection.assistant);
  return boundText(`${lines.join("\n")}\n`);
}

function appendTurn(
  lines: string[],
  turn: RecoveryDocument["turns"][number],
  assistantMode: RecoveryDocument["selection"]["assistant"],
): void {
  lines.push(
    "",
    `Turn ${String(turn.number)} · ${turn.startedAt}`,
    "",
    "USER",
    excerptText(turn.user.text),
    "",
    "ASSISTANT",
  );
  appendAssistant(lines, turn, assistantMode);
  appendControl(lines, turn);
}

function appendAssistant(
  lines: string[],
  turn: RecoveryDocument["turns"][number],
  assistantMode: RecoveryDocument["selection"]["assistant"],
): void {
  if (turn.assistant.status === "omitted") {
    lines.push("[Assistant output omitted by --assistant none]");
    return;
  }
  for (const message of turn.assistant.messages) {
    if (assistantMode === "text") lines.push(`[${message.kind}]`);
    lines.push(excerptText(message.text));
  }
  if (turn.assistant.status === "interrupted") {
    lines.push("[No final response: turn was interrupted]");
  }
}

function appendControl(lines: string[], turn: RecoveryDocument["turns"][number]): void {
  if (turn.control.length === 0) return;
  lines.push("", "CONTROL");
  for (const event of turn.control) {
    const action = event.action === undefined ? "" : ` ${event.action}`;
    lines.push(
      `[${event.kind}] ${event.toolName}${action} ${event.phase} · ${event.entryId}`,
      excerptText(event.text),
    );
  }
}

export function renderEntryText(document: EntryDocument): string {
  const lines = [
    `Session: ${document.session.id}`,
    `File: ${document.session.file}`,
    `Integrity: ${document.integrity.status}`,
  ];
  appendIntegrity(lines, document);
  if (document.entry === null) {
    lines.push("", "Entry: not found");
  } else {
    lines.push(
      "",
      `Entry: ${document.entry.id}`,
      `Parent: ${document.entry.parentId ?? "null"}`,
      `Timestamp: ${document.entry.timestamp}`,
      `Type: ${document.entry.type}`,
      "",
      excerptText(document.entry.summary),
    );
  }
  return boundText(`${lines.join("\n")}\n`);
}

export function renderListText(document: SessionListDocument): string {
  const lines = [
    `Scope: ${document.scope}`,
    `Directory: ${document.cwd}`,
    `Sessions: ${String(document.sessions.length)} of ${String(document.totalSessions)}`,
  ];
  for (const session of document.sessions) {
    lines.push(
      "",
      `${session.id} · ${session.modified}`,
      `File: ${session.path}`,
      `Cwd: ${session.cwd}`,
      `Name: ${session.name ?? "[unnamed]"}`,
      `Messages: ${String(session.messageCount)}`,
      `First message: ${excerptText(session.firstMessage)}`,
    );
  }
  return boundText(`${lines.join("\n")}\n`);
}

function appendIntegrity(
  lines: string[],
  document: Pick<RecoveryDocument, "integrity"> | Pick<EntryDocument, "integrity">,
): void {
  for (const item of document.integrity.issues) {
    const location = [
      item.entryId === undefined ? "" : `entry ${item.entryId}`,
      item.line === undefined ? "" : `line ${String(item.line)}`,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(
      `Integrity ${item.severity}: ${item.code}${location === "" ? "" : ` (${location})`}: ${item.message}`,
    );
  }
  if (document.integrity.omittedIssues > 0) {
    lines.push(`Integrity: ${String(document.integrity.omittedIssues)} additional issues omitted.`);
  }
}

function excerptText(excerpt: Excerpt): string {
  const lines = excerpt.text === "" ? ["[No visible text]"] : [excerpt.text];
  if (excerpt.redactions > 0) {
    lines.push(
      `[Redacted ${String(excerpt.redactions)} likely credential${excerpt.redactions === 1 ? "" : "s"}]`,
    );
  }
  for (const omission of excerpt.omissions) lines.push(`[Omitted: ${omission}]`);
  if (excerpt.truncated) {
    lines.push(
      `[Excerpt truncated: showing ${formatSize(excerpt.shownBytes)} of ${formatSize(excerpt.originalBytes)}; ${formatSize(excerpt.omittedBytes)} omitted]`,
    );
  }
  return lines.join("\n");
}

function boundText(value: string): string {
  if (Buffer.byteLength(value) <= TOTAL_OUTPUT_BYTES) return value;
  const result = truncateHead(value, {
    maxBytes: TOTAL_OUTPUT_BYTES - OUTPUT_NOTICE_RESERVE,
    maxLines: 100_000,
  });
  const omitted = result.totalBytes - result.outputBytes;
  return `${result.content}\n[Output truncated: ${formatSize(omitted)} omitted from ${formatSize(result.totalBytes)} rendered evidence.]\n`;
}
