import { booleanValue, asRecord, arrayValue, stringValue } from "./load.js";
import { boundedExcerpt } from "./redact.js";
import {
  CONTROL_EXCERPT_BYTES,
  INCLUDE_KINDS,
  MESSAGE_EXCERPT_BYTES,
  OUTPUT_SCHEMA,
  type AssistantEvidence,
  type AssistantSelection,
  type ControlEvent,
  type EntryDocument,
  type Excerpt,
  type IncludeKind,
  type LoadedSession,
  type RecoveryDocument,
  type RecoveryOptions,
  type SafeEntry,
  type TurnEvidence,
} from "./types.js";

const MAX_CONTROL_LABEL_CHARS = 256;
const MAX_VISIBLE_OMISSION_NOTICES = 20;

type VisibleContent = {
  readonly text: string;
  readonly omissions: readonly string[];
};

type ToolCall = {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
};

type TurnBuilder = {
  readonly number: number;
  readonly entries: SafeEntry[];
  readonly user: SafeEntry;
};

export function selectRecovery(session: LoadedSession, options: RecoveryOptions): RecoveryDocument {
  const builders = groupTurns(session.branch);
  const selectedRange = applySince(builders, options.since);
  const selected = selectedRange.slice(-options.last);
  const omittedTurns = builders.length - selected.length;
  const turns = selected.map((turn) => buildTurn(turn, options));
  return {
    schema: OUTPUT_SCHEMA,
    session: sessionSummary(session),
    integrity: session.integrity,
    selection: {
      assistant: options.assistant,
      include: INCLUDE_KINDS.filter((kind) => options.include.has(kind)),
      requestedLast: options.last,
      since: options.since ?? null,
      totalTurns: builders.length,
      selectedTurns: turns.length,
      omittedTurns,
      omittedControlEvents: 0,
      outputTruncated: false,
    },
    turns,
    nextOffset: omittedTurns > 0 ? omittedTurns : null,
  };
}

export function selectEntry(session: LoadedSession, entryId: string): EntryDocument {
  const entry = session.entries.find((candidate) => candidate.id === entryId);
  return {
    schema: OUTPUT_SCHEMA,
    session: sessionSummary(session),
    integrity: session.integrity,
    entry:
      entry === undefined
        ? null
        : {
            id: entry.id,
            parentId: entry.parentId,
            timestamp: entry.timestamp,
            type: entry.type,
            summary: summarizeEntry(entry),
          },
  };
}

function groupTurns(branch: readonly SafeEntry[]): TurnBuilder[] {
  const turns: TurnBuilder[] = [];
  let current: TurnBuilder | undefined;
  for (const entry of branch) {
    if (messageRole(entry) === "user") {
      current = { number: turns.length + 1, entries: [entry], user: entry };
      turns.push(current);
    } else if (current !== undefined) {
      current.entries.push(entry);
    }
  }
  return turns;
}

function applySince(turns: readonly TurnBuilder[], since: string | undefined): TurnBuilder[] {
  if (since === undefined) return [...turns];
  const entryTurn = turns.findIndex((turn) => turn.entries.some((entry) => entry.id === since));
  if (entryTurn >= 0) return turns.slice(entryTurn);
  const timestamp = Date.parse(since);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`--since is not an active-branch entry id or timestamp: ${since}`);
  }
  const first = turns.findIndex((turn) =>
    turn.entries.some((entry) => Date.parse(entry.timestamp) >= timestamp),
  );
  return first < 0 ? [] : turns.slice(first);
}

function buildTurn(turn: TurnBuilder, options: RecoveryOptions): TurnEvidence {
  const finalIndex = findFinalAssistantIndex(turn.entries);
  return {
    number: turn.number,
    entryIds: turn.entries.map((entry) => entry.id),
    startedAt: turn.user.timestamp,
    endedAt: turn.entries.at(-1)?.timestamp ?? turn.user.timestamp,
    user: {
      entryId: turn.user.id,
      timestamp: turn.user.timestamp,
      text: excerptVisible(messageContent(turn.user), MESSAGE_EXCERPT_BYTES),
    },
    assistant: selectAssistant(turn.entries, finalIndex, options.assistant),
    control: extractControls(turn.entries, options.include),
  };
}

function findFinalAssistantIndex(entries: readonly SafeEntry[]): number | undefined {
  let finalToolResult = -1;
  for (let index = 0; index < entries.length; index += 1) {
    if (messageRole(entries[index]) === "toolResult") finalToolResult = index;
  }
  let final: number | undefined;
  for (let index = finalToolResult + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || messageRole(entry) !== "assistant") continue;
    const visible = messageContent(entry);
    if (visible.text.trim() !== "" && toolCalls(entry).length === 0) final = index;
  }
  return final;
}

function selectAssistant(
  entries: readonly SafeEntry[],
  finalIndex: number | undefined,
  mode: RecoveryOptions["assistant"],
): AssistantSelection {
  if (mode === "none") return { status: "omitted", messages: [] };
  const messages = entries.flatMap((entry, index) =>
    assistantEvidence(entry, index, finalIndex, mode),
  );
  return { status: finalIndex === undefined ? "interrupted" : "complete", messages };
}

function assistantEvidence(
  entry: SafeEntry,
  index: number,
  finalIndex: number | undefined,
  mode: RecoveryOptions["assistant"],
): AssistantEvidence[] {
  if (messageRole(entry) !== "assistant") return [];
  const visible = messageContent(entry);
  if (visible.text.trim() === "") return [];
  const isFinal = index === finalIndex;
  if (mode === "final" && !isFinal) return [];
  return [
    {
      entryId: entry.id,
      timestamp: entry.timestamp,
      kind: isFinal ? "final" : "intermediate",
      text: excerptVisible(visible, MESSAGE_EXCERPT_BYTES),
    },
  ];
}

function extractControls(
  entries: readonly SafeEntry[],
  includes: ReadonlySet<IncludeKind>,
): ControlEvent[] {
  const events: ControlEvent[] = [];
  const callsById = new Map<string, ToolCall>();
  for (const entry of entries) {
    for (const call of toolCalls(entry)) {
      callsById.set(call.id, call);
      const event = controlCall(entry, call, includes);
      if (event !== undefined) events.push(event);
    }
    events.push(...controlResultEvents(entry, callsById, includes));
  }
  return events;
}

function controlResultEvents(
  entry: SafeEntry,
  callsById: ReadonlyMap<string, ToolCall>,
  includes: ReadonlySet<IncludeKind>,
): ControlEvent[] {
  const result = toolResult(entry);
  if (result === undefined) return [];
  const call = callsById.get(result.callId);
  const events: ControlEvent[] = [];
  if (includes.has("workflow") && normalizedToolName(result.toolName) === "workflow") {
    events.push(
      controlResult(
        entry,
        "workflow",
        result.toolName,
        toolAction(call),
        result.content,
        CONTROL_EXCERPT_BYTES,
      ),
    );
  }
  if (includes.has("errors") && result.isError) {
    events.push(
      controlResult(
        entry,
        "errors",
        result.toolName,
        toolAction(call),
        result.content,
        MESSAGE_EXCERPT_BYTES,
      ),
    );
  }
  return events;
}

function controlCall(
  entry: SafeEntry,
  call: ToolCall,
  includes: ReadonlySet<IncludeKind>,
): ControlEvent | undefined {
  const kind = controlKind(normalizedToolName(call.name), includes);
  if (kind === undefined) return undefined;
  const text = kind === "files" ? filePath(call.arguments) : stringify(call.arguments);
  return callEvent(entry, kind, call, text);
}

function controlKind(name: string, includes: ReadonlySet<IncludeKind>): IncludeKind | undefined {
  if (name === "update_plan" && includes.has("plan")) return "plan";
  if (name === "workflow" && includes.has("workflow")) return "workflow";
  if (["edit", "write"].includes(name) && includes.has("files")) return "files";
  return undefined;
}

function filePath(value: unknown): string {
  const args = asRecord(value);
  return (
    stringValue(args?.["path"]) ?? stringValue(args?.["file_path"]) ?? "[file path unavailable]"
  );
}

function callEvent(
  entry: SafeEntry,
  kind: IncludeKind,
  call: ToolCall,
  text: string,
): ControlEvent {
  const action = toolAction(call);
  return {
    entryId: entry.id,
    timestamp: entry.timestamp,
    kind,
    toolName: call.name,
    phase: "call",
    ...(action === undefined ? {} : { action }),
    text: boundedExcerpt(text, CONTROL_EXCERPT_BYTES),
  };
}

function controlResult(
  entry: SafeEntry,
  kind: IncludeKind,
  toolName: string,
  action: string | undefined,
  content: VisibleContent,
  maxBytes: number,
): ControlEvent {
  return {
    entryId: entry.id,
    timestamp: entry.timestamp,
    kind,
    toolName,
    phase: "result",
    ...(action === undefined ? {} : { action }),
    text: excerptVisible(content, maxBytes),
  };
}

function toolCalls(entry: SafeEntry | undefined): ToolCall[] {
  if (entry === undefined || messageRole(entry) !== "assistant") return [];
  const message = asRecord(entry.raw["message"]);
  return (arrayValue(message?.["content"]) ?? []).flatMap(parseToolCall);
}

function parseToolCall(block: unknown): ToolCall[] {
  const record = asRecord(block);
  if (record?.["type"] !== "toolCall") return [];
  const id = boundedLabel(record["id"], MAX_CONTROL_LABEL_CHARS);
  const name = boundedLabel(record["name"], MAX_CONTROL_LABEL_CHARS);
  return id === undefined || name === undefined
    ? []
    : [{ id, name, arguments: record["arguments"] }];
}

function toolResult(entry: SafeEntry):
  | {
      readonly callId: string;
      readonly toolName: string;
      readonly isError: boolean;
      readonly content: VisibleContent;
    }
  | undefined {
  if (messageRole(entry) !== "toolResult") return undefined;
  const message = asRecord(entry.raw["message"]);
  if (message === undefined) return undefined;
  const callId = boundedLabel(message["toolCallId"], MAX_CONTROL_LABEL_CHARS);
  const toolName = boundedLabel(message["toolName"], MAX_CONTROL_LABEL_CHARS);
  if (callId === undefined || toolName === undefined) return undefined;
  return {
    callId,
    toolName,
    isError: booleanValue(message["isError"]) ?? false,
    content: visibleContent(message["content"]),
  };
}

function toolAction(call: ToolCall | undefined): string | undefined {
  const args = asRecord(call?.arguments);
  return boundedLabel(args?.["action"], MAX_CONTROL_LABEL_CHARS);
}

function normalizedToolName(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function messageRole(entry: SafeEntry | undefined): string | undefined {
  if (entry?.type !== "message") return undefined;
  return stringValue(asRecord(entry.raw["message"])?.["role"]);
}

function messageContent(entry: SafeEntry): VisibleContent {
  const message = asRecord(entry.raw["message"]);
  return visibleContent(message?.["content"]);
}

function visibleContent(content: unknown): VisibleContent {
  if (typeof content === "string") return { text: content, omissions: [] };
  const parts = (arrayValue(content) ?? []).map(visibleBlock);
  return {
    text: parts.map((part) => part.text).join(""),
    omissions: parts.flatMap((part) => part.omissions),
  };
}

function visibleBlock(block: unknown): VisibleContent {
  const record = asRecord(block);
  if (record?.["type"] === "text") {
    return { text: stringValue(record["text"]) ?? "", omissions: [] };
  }
  if (record?.["type"] === "image") {
    const mimeType = stringValue(record["mimeType"]) ?? "unknown type";
    return { text: "", omissions: [`image omitted (${mimeType})`] };
  }
  return { text: "", omissions: [] };
}

function excerptVisible(content: VisibleContent, maxBytes: number): Excerpt {
  const excerpt = boundedExcerpt(content.text, maxBytes);
  const omissions = [...content.omissions, ...excerpt.omissions];
  return { ...excerpt, omissions: boundedVisibleOmissions(omissions) };
}

function boundedVisibleOmissions(omissions: readonly string[]): string[] {
  if (omissions.length <= MAX_VISIBLE_OMISSION_NOTICES) return [...omissions];
  return [
    ...omissions.slice(0, MAX_VISIBLE_OMISSION_NOTICES),
    `${String(omissions.length - MAX_VISIBLE_OMISSION_NOTICES)} more omission notices`,
  ];
}

function boundedLabel(value: unknown, maxChars: number): string | undefined {
  const text = stringValue(value);
  return text !== undefined && text.length <= maxChars ? text : undefined;
}

function summarizeEntry(entry: SafeEntry): Excerpt {
  if (entry.type === "message") return summarizeMessage(entry);
  if (entry.type === "compaction" || entry.type === "branch_summary") {
    return boundedExcerpt(
      stringValue(entry.raw["summary"]) ?? "[summary unavailable]",
      MESSAGE_EXCERPT_BYTES,
    );
  }
  if (entry.type === "custom_message") {
    return excerptVisible(visibleContent(entry.raw["content"]), MESSAGE_EXCERPT_BYTES);
  }
  if (entry.type === "custom") {
    return boundedExcerpt(
      `custom entry ${stringValue(entry.raw["customType"]) ?? "unknown"}; metadata omitted`,
      MESSAGE_EXCERPT_BYTES,
    );
  }
  return boundedExcerpt(summarizeFields(entry), MESSAGE_EXCERPT_BYTES);
}

function summarizeMessage(entry: SafeEntry): Excerpt {
  return messageRole(entry) === "toolResult"
    ? summarizeToolResult(entry)
    : summarizeVisibleMessage(entry);
}

function summarizeToolResult(entry: SafeEntry): Excerpt {
  const result = toolResult(entry);
  const content = result?.content ?? { text: "", omissions: [] };
  if (result?.isError === true) return excerptVisible(content, MESSAGE_EXCERPT_BYTES);
  const bytes = Buffer.byteLength(content.text);
  return boundedExcerpt(
    `tool result ${result?.toolName ?? "unknown"}; body omitted (${String(bytes)} bytes)`,
    MESSAGE_EXCERPT_BYTES,
  );
}

function summarizeVisibleMessage(entry: SafeEntry): Excerpt {
  const content = messageContent(entry);
  const calls = toolCalls(entry).map((call) => call.name);
  const prefix = calls.length > 0 ? `[tool calls: ${calls.join(", ")}]\n` : "";
  return excerptVisible(
    { text: `${prefix}${content.text}`, omissions: content.omissions },
    MESSAGE_EXCERPT_BYTES,
  );
}

const FIELD_SUMMARIZERS: Readonly<Record<string, (entry: SafeEntry) => string>> = {
  model_change: (entry) =>
    `model ${stringValue(entry.raw["provider"]) ?? "unknown"}/${stringValue(entry.raw["modelId"]) ?? "unknown"}`,
  thinking_level_change: (entry) =>
    `thinking level ${stringValue(entry.raw["thinkingLevel"]) ?? "unknown"}`,
  session_info: (entry) => `session name ${stringValue(entry.raw["name"]) ?? "[cleared]"}`,
  label: (entry) => `label on ${stringValue(entry.raw["targetId"]) ?? "unknown"}`,
};

function summarizeFields(entry: SafeEntry): string {
  const summarize = FIELD_SUMMARIZERS[entry.type];
  return summarize === undefined ? `${entry.type} entry; raw metadata omitted` : summarize(entry);
}

function sessionSummary(session: LoadedSession): RecoveryDocument["session"] {
  return {
    id: session.id,
    file: session.path,
    cwd: session.cwd,
    version: session.version,
    entries: session.entries.length,
    activeBranchEntries: session.branch.length,
  };
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[arguments unavailable]";
  }
}
