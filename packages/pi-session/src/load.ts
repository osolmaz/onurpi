import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  CURRENT_SESSION_VERSION,
  SessionManager,
  type SessionInfo,
} from "@earendil-works/pi-coding-agent";

import { boundedExcerpt } from "./redact.js";
import {
  MESSAGE_EXCERPT_BYTES,
  type IntegrityIssue,
  type IntegrityReport,
  type LoadedSession,
  type RawRecord,
  type SafeEntry,
  type ScanResult,
} from "./types.js";

const MAX_SCANNED_LINE_BYTES = 64 * 1024;
const MAX_REPORTED_LINES = 20;
const MAX_INTEGRITY_ISSUES = 200;
const MAX_ENTRY_ID_CHARS = 256;
const MAX_ENTRY_TYPE_CHARS = 128;
const MAX_TIMESTAMP_CHARS = 64;
const MAX_CWD_CHARS = 4_096;
const UUID_PREFIX = /^[0-9a-f-]+$/iu;

export async function resolveSessionPath(
  input: string,
  cwd: string,
  allProjects: boolean,
): Promise<string> {
  if (isAbsolute(input)) return await requireRegularFile(input);
  if (!UUID_PREFIX.test(input)) {
    throw new Error("session must be an absolute path, a UUID, or a UUID prefix");
  }
  const sessions = await listSessions(cwd, allProjects);
  const matches = uniqueByPath(sessions.filter((session) => session.id.startsWith(input)));
  assertSessionMatches(matches, input, cwd, allProjects);
  const match = matches[0];
  if (match === undefined) throw new Error("session lookup failed");
  return await requireRegularFile(match.path);
}

export async function listSessions(cwd: string, allProjects: boolean): Promise<SessionInfo[]> {
  const sessions = await SessionManager.listAll();
  if (allProjects) return sessions;
  const target = resolve(cwd);
  return sessions.filter((session) => resolve(session.cwd) === target);
}

function assertSessionMatches(
  matches: readonly SessionInfo[],
  input: string,
  cwd: string,
  allProjects: boolean,
): void {
  if (matches.length === 0) {
    const scope = allProjects ? "all projects" : `the current directory (${cwd})`;
    throw new Error(`no session UUID matching ${input} in ${scope}`);
  }
  if (matches.length <= 1) return;
  const ids = matches
    .slice(0, 5)
    .map((session) => boundedExcerpt(session.id, MAX_ENTRY_ID_CHARS).text)
    .join(", ");
  throw new Error(`session UUID prefix is ambiguous: ${ids}${matches.length > 5 ? ", …" : ""}`);
}

export async function loadSession(path: string): Promise<LoadedSession> {
  const resolvedPath = await requireRegularFile(path);
  const scan = await scanSessionFile(resolvedPath);
  const initialIssues = scanIssues(scan);
  const header = asRecord(scan.firstParsed);
  if (header?.["type"] !== "session") {
    return invalidLoadedSession(resolvedPath, header, [
      ...initialIssues,
      issue("invalid_header", "error", "The first parsed record is not a Pi session header."),
    ]);
  }
  const version = numberValue(header["version"]);
  const headerIssues = validateHeader(header, version);
  if (
    version !== CURRENT_SESSION_VERSION ||
    headerIssues.some((item) => item.severity === "error")
  ) {
    return invalidLoadedSession(resolvedPath, header, [...initialIssues, ...headerIssues]);
  }

  const manager = SessionManager.open(resolvedPath);
  const rawEntries: unknown[] = manager.getEntries().map((entry) => entry as unknown);
  const validation = validateEntries(rawEntries);
  const issues = [...initialIssues, ...headerIssues, ...validation.issues];
  const branch = validation.fatal ? [] : safeBranch(manager.getBranch());
  return {
    path: resolvedPath,
    id: manager.getSessionId(),
    cwd: manager.getCwd(),
    version,
    entries: validation.entries,
    branch,
    integrity: report(issues),
  };
}

export async function scanSessionFile(path: string): Promise<ScanResult> {
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  let lineNumber = 1;
  let lineBytes = 0;
  let oversized = false;
  let chunks: Buffer[] = [];
  let firstParsed: unknown;
  let foundFirstParsed = false;
  let malformedLineCount = 0;
  let oversizedLineCount = 0;
  const malformedLines: number[] = [];
  const oversizedLines: number[] = [];

  const finishLine = (): void => {
    if (oversized) {
      oversizedLineCount += 1;
      pushBounded(oversizedLines, lineNumber);
    } else if (lineBytes > 0) {
      const line = Buffer.concat(chunks, lineBytes).toString("utf8").replace(/\r$/u, "");
      if (line.trim() !== "") {
        try {
          const parsed: unknown = JSON.parse(line) as unknown;
          if (!foundFirstParsed) {
            firstParsed = parsed;
            foundFirstParsed = true;
          }
        } catch {
          malformedLineCount += 1;
          pushBounded(malformedLines, lineNumber);
        }
      }
    }
    lineNumber += 1;
    lineBytes = 0;
    oversized = false;
    chunks = [];
  };

  for await (const value of stream as AsyncIterable<unknown>) {
    if (!Buffer.isBuffer(value)) throw new Error("session stream returned non-binary data");
    const chunk = value;
    let start = 0;
    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      appendLineBytes(chunk.subarray(start, index));
      finishLine();
      start = index + 1;
    }
    appendLineBytes(chunk.subarray(start));
  }
  if (lineBytes > 0) finishLine();

  return {
    firstParsed,
    malformedLines,
    malformedLineCount,
    oversizedLines,
    oversizedLineCount,
  };

  function appendLineBytes(part: Buffer): void {
    if (part.length === 0) return;
    lineBytes += part.length;
    if (oversized) return;
    if (lineBytes > MAX_SCANNED_LINE_BYTES) {
      oversized = true;
      chunks = [];
      return;
    }
    chunks.push(part);
  }
}

function validateHeader(header: RawRecord, version: number | null): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  if (boundedString(header["id"], MAX_ENTRY_ID_CHARS) === undefined) {
    issues.push(issue("invalid_session_id", "error", "The session header has no bounded id."));
  }
  if (boundedString(header["cwd"], MAX_CWD_CHARS) === undefined) {
    issues.push(issue("invalid_session_cwd", "error", "The session header has no bounded cwd."));
  }
  if (version === null) {
    issues.push(
      issue("invalid_session_version", "error", "The session header has no numeric version."),
    );
  } else if (version < CURRENT_SESSION_VERSION) {
    issues.push(
      issue(
        "legacy_session_version",
        "error",
        `Session version ${String(version)} is not opened because Pi would migrate and rewrite it.`,
      ),
    );
  } else if (version > CURRENT_SESSION_VERSION) {
    issues.push(
      issue(
        "unsupported_session_version",
        "error",
        `Session version ${String(version)} is newer than supported version ${String(CURRENT_SESSION_VERSION)}.`,
      ),
    );
  }
  return issues;
}

function validateEntries(rawEntries: readonly unknown[]): {
  readonly entries: readonly SafeEntry[];
  readonly issues: readonly IntegrityIssue[];
  readonly fatal: boolean;
} {
  const entries = rawEntries.flatMap((raw) => {
    const entry = safeEntry(raw);
    return entry === undefined ? [] : [entry];
  });
  const ids = new Set(entries.map((entry) => entry.id));
  const issues = [
    ...entryShapeIssues(rawEntries.length, entries),
    ...duplicateIdIssues(entries),
    ...missingParentIssues(entries, ids),
    ...rootIssues(entries),
    ...findCycleIds(entries).map((id) =>
      issue("parent_cycle", "error", "The parent chain contains a cycle.", id),
    ),
    ...messageIntegrityIssues(entries),
  ];
  const fatalCodes = new Set([
    "invalid_entry",
    "invalid_active_leaf",
    "duplicate_entry_id",
    "missing_root",
    "parent_cycle",
  ]);
  return {
    entries,
    issues,
    fatal: issues.some((item) => fatalCodes.has(item.code)),
  };
}

function entryShapeIssues(rawCount: number, entries: readonly SafeEntry[]): IntegrityIssue[] {
  if (entries.length !== rawCount) {
    return [
      issue("invalid_entry", "error", "A parsed session entry has an invalid base shape."),
      issue("invalid_active_leaf", "error", "The last parsed entry is not a valid active leaf."),
    ];
  }
  return entries.length === 0
    ? [issue("missing_active_leaf", "warning", "The session has no active leaf entry.")]
    : [];
}

function duplicateIdIssues(entries: readonly SafeEntry[]): IntegrityIssue[] {
  const seen = new Set<string>();
  const issues: IntegrityIssue[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      issues.push(
        issue("duplicate_entry_id", "error", "An entry id occurs more than once.", entry.id),
      );
    }
    seen.add(entry.id);
  }
  return issues;
}

function missingParentIssues(
  entries: readonly SafeEntry[],
  ids: ReadonlySet<string>,
): IntegrityIssue[] {
  return entries.flatMap((entry) =>
    entry.parentId !== null && !ids.has(entry.parentId)
      ? [issue("missing_parent", "error", "An entry refers to a missing parent.", entry.id)]
      : [],
  );
}

function rootIssues(entries: readonly SafeEntry[]): IntegrityIssue[] {
  const roots = entries.filter((entry) => entry.parentId === null).length;
  if (entries.length > 0 && roots === 0) {
    return [issue("missing_root", "error", "The session tree has no root entry.")];
  }
  return roots > 1
    ? [issue("multiple_roots", "warning", `The session tree has ${String(roots)} root entries.`)]
    : [];
}

type MessageIntegrityState = {
  readonly issues: IntegrityIssue[];
  readonly calls: Set<string>;
  readonly results: Set<string>;
  sawUser: boolean;
};

function messageIntegrityIssues(entries: readonly SafeEntry[]): IntegrityIssue[] {
  const state: MessageIntegrityState = {
    issues: [],
    calls: new Set(),
    results: new Set(),
    sawUser: false,
  };
  for (const entry of entries) inspectMessageIntegrity(entry, state);
  return [...state.issues, ...missingPairIssues(state.calls, state.results)];
}

function inspectMessageIntegrity(entry: SafeEntry, state: MessageIntegrityState): void {
  if (entry.type !== "message") return;
  const message = asRecord(entry.raw["message"]);
  if (message === undefined) {
    state.issues.push(
      issue("invalid_message", "error", "A message entry has no valid message object.", entry.id),
    );
    return;
  }
  const role = stringValue(message["role"]);
  inspectContentSize(entry, role, message["content"], state.issues);
  if (role === "user") state.sawUser = true;
  if (role === "assistant") inspectAssistantIntegrity(entry, message, state);
  if (role === "toolResult") addString(message["toolCallId"], state.results);
}

function inspectContentSize(
  entry: SafeEntry,
  role: string | undefined,
  content: unknown,
  issues: IntegrityIssue[],
): void {
  const contentBytes = jsonBytes(content);
  if (contentBytes <= MESSAGE_EXCERPT_BYTES) return;
  const roleLabel = role?.slice(0, MAX_ENTRY_TYPE_CHARS) ?? "unknown";
  issues.push(
    issue(
      role === "toolResult" ? "oversized_tool_result" : "oversized_message",
      "warning",
      `${roleLabel} content is ${String(contentBytes)} bytes and will be excerpted.`,
      entry.id,
    ),
  );
}

function inspectAssistantIntegrity(
  entry: SafeEntry,
  message: RawRecord,
  state: MessageIntegrityState,
): void {
  const blocks = arrayValue(message["content"]);
  if (state.sawUser && (blocks === undefined || blocks.length === 0)) {
    state.issues.push(
      issue("empty_assistant_message", "warning", "An assistant message is empty.", entry.id),
    );
  }
  for (const block of blocks ?? []) {
    const record = asRecord(block);
    if (record?.["type"] === "toolCall") addString(record["id"], state.calls);
  }
}

function addString(value: unknown, target: Set<string>): void {
  const text = boundedString(value, MAX_ENTRY_ID_CHARS);
  if (text !== undefined) target.add(text);
}

function missingPairIssues(
  calls: ReadonlySet<string>,
  results: ReadonlySet<string>,
): IntegrityIssue[] {
  return [
    ...[...calls]
      .filter((callId) => !results.has(callId))
      .map((callId) =>
        issue("missing_tool_result", "warning", `Tool call ${callId} has no result.`),
      ),
    ...[...results]
      .filter((callId) => !calls.has(callId))
      .map((callId) => issue("missing_tool_call", "warning", `Tool result ${callId} has no call.`)),
  ];
}

function findCycleIds(entries: readonly SafeEntry[]): string[] {
  const parents = new Map(entries.map((entry) => [entry.id, entry.parentId] as const));
  const complete = new Set<string>();
  const cycles = new Set<string>();
  for (const start of parents.keys()) {
    if (complete.has(start)) continue;
    const path: string[] = [];
    const positions = new Map<string, number>();
    let current: string | null | undefined = start;
    while (canFollowParent(current, complete)) {
      const prior = positions.get(current);
      if (prior !== undefined) {
        for (const id of path.slice(prior)) cycles.add(id);
        break;
      }
      positions.set(current, path.length);
      path.push(current);
      current = parents.get(current);
    }
    for (const id of path) complete.add(id);
  }
  return [...cycles].sort();
}

function canFollowParent(
  current: string | null | undefined,
  complete: ReadonlySet<string>,
): current is string {
  return typeof current === "string" && !complete.has(current);
}

function safeBranch(entries: readonly unknown[]): SafeEntry[] {
  const branch: SafeEntry[] = [];
  for (const raw of entries) {
    const entry = safeEntry(raw);
    if (entry !== undefined) branch.push(entry);
  }
  return branch;
}

function safeEntry(value: unknown): SafeEntry | undefined {
  const raw = asRecord(value);
  if (raw === undefined) return undefined;
  const id = boundedString(raw["id"], MAX_ENTRY_ID_CHARS);
  const timestamp = boundedString(raw["timestamp"], MAX_TIMESTAMP_CHARS);
  const type = boundedString(raw["type"], MAX_ENTRY_TYPE_CHARS);
  const parent = raw["parentId"];
  const parentId = parent === null ? null : boundedString(parent, MAX_ENTRY_ID_CHARS);
  if (id === undefined || timestamp === undefined || type === undefined) return undefined;
  if (parentId === undefined) return undefined;
  return { raw, id, parentId, timestamp, type };
}

function scanIssues(scan: ScanResult): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  for (const line of scan.malformedLines) {
    issues.push(
      issue("malformed_jsonl", "warning", "A malformed JSONL record was skipped.", undefined, line),
    );
  }
  if (scan.malformedLineCount > scan.malformedLines.length) {
    issues.push(
      issue(
        "malformed_jsonl_omitted",
        "warning",
        `${String(scan.malformedLineCount - scan.malformedLines.length)} more malformed records were not listed.`,
      ),
    );
  }
  for (const line of scan.oversizedLines) {
    issues.push(
      issue(
        "oversized_jsonl_record",
        "warning",
        `A JSONL record exceeds the ${String(MAX_SCANNED_LINE_BYTES)}-byte integrity scan limit.`,
        undefined,
        line,
      ),
    );
  }
  if (scan.oversizedLineCount > scan.oversizedLines.length) {
    issues.push(
      issue(
        "oversized_jsonl_omitted",
        "warning",
        `${String(scan.oversizedLineCount - scan.oversizedLines.length)} more oversized records were not listed.`,
      ),
    );
  }
  return issues;
}

function invalidLoadedSession(
  path: string,
  header: RawRecord | undefined,
  issues: readonly IntegrityIssue[],
): LoadedSession {
  return {
    path,
    id: boundedString(header?.["id"], MAX_ENTRY_ID_CHARS) ?? "unknown",
    cwd: boundedString(header?.["cwd"], MAX_CWD_CHARS) ?? "",
    version: numberValue(header?.["version"]),
    entries: [],
    branch: [],
    integrity: report(issues),
  };
}

function issue(
  code: string,
  severity: "warning" | "error",
  message: string,
  entryId?: string,
  line?: number,
): IntegrityIssue {
  return {
    code,
    severity,
    message,
    ...(entryId === undefined ? {} : { entryId }),
    ...(line === undefined ? {} : { line }),
  };
}

function limitIssues(issues: readonly IntegrityIssue[]): IntegrityIssue[] {
  if (issues.length <= MAX_INTEGRITY_ISSUES) return [...issues];
  return [
    ...issues.slice(0, MAX_INTEGRITY_ISSUES - 1),
    issue(
      "integrity_issues_omitted",
      "warning",
      `${String(issues.length - MAX_INTEGRITY_ISSUES + 1)} more integrity issues were omitted.`,
    ),
  ];
}

function report(issues: readonly IntegrityIssue[]): IntegrityReport {
  const omittedIssues =
    issues.length > MAX_INTEGRITY_ISSUES ? issues.length - MAX_INTEGRITY_ISSUES + 1 : 0;
  return {
    status: issues.length === 0 ? "ok" : "issues",
    issues: limitIssues(issues),
    omittedIssues,
  };
}

async function requireRegularFile(path: string): Promise<string> {
  const resolved = await realpath(path);
  const metadata = await stat(resolved);
  if (!metadata.isFile()) throw new Error(`session path is not a regular file: ${resolved}`);
  if (metadata.size === 0) throw new Error(`session file is empty: ${resolved}`);
  return resolved;
}

function uniqueByPath(sessions: readonly SessionInfo[]): SessionInfo[] {
  const seen = new Set<string>();
  return sessions.filter((session) => {
    if (seen.has(session.path)) return false;
    seen.add(session.path);
    return true;
  });
}

function jsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value));
  } catch {
    return 0;
  }
}

function pushBounded(values: number[], value: number): void {
  if (values.length < MAX_REPORTED_LINES) values.push(value);
}

export function asRecord(value: unknown): RawRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as RawRecord;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  const text = stringValue(value);
  return text !== undefined && text.length <= maxChars ? text : undefined;
}

export function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function arrayValue(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}
