import {
  entryTimestamp,
  isRecord,
  messageFromEntry,
  numberField,
  stringField,
} from "./turn-message.ts";

export type HistoryEntryKind = "assistant" | "compaction" | "custom" | "error" | "tool" | "user";

export type HistoryFilter =
  | "all"
  | "assistant"
  | "compactions"
  | "custom"
  | "errors"
  | "tools"
  | "user";

export type HistorySectionKind = "diff" | "text" | "thinking" | "toolOutput";

export type HistorySection = Readonly<{
  kind: HistorySectionKind;
  text: string;
}>;

export type HistoryEntryPresentation = Readonly<{
  hasDiff: boolean;
  hasThinking: boolean;
  hasToolOutput: boolean;
  isError: boolean;
  kind: HistoryEntryKind;
  label: string;
  searchableText: string;
  sections: readonly HistorySection[];
  summary: string | undefined;
  timestamp: number | undefined;
  toolCallId: string | undefined;
  toolName: string | undefined;
}>;

const FILTER_ORDER: readonly HistoryFilter[] = [
  "all",
  "user",
  "assistant",
  "tools",
  "errors",
  "compactions",
  "custom",
];

function booleanField(value: unknown, key: string): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "boolean" ? field : undefined;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, undefined, 2);
  } catch {
    return "[unserializable arguments]";
  }
}

function argumentValue(arguments_: unknown, key: string): string | undefined {
  if (!isRecord(arguments_)) return undefined;
  const value = arguments_[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function toolSummary(item: unknown): string {
  const name = stringField(item, "name") ?? "unknown tool";
  if (!isRecord(item)) return name;
  const arguments_ = item["arguments"];
  const detailKeys = ["path", "file_path", "command", "cmd", "query", "url"] as const;
  for (const key of detailKeys) {
    const value = argumentValue(arguments_, key);
    if (value) return `${name} · ${value}`;
  }
  return name;
}

function isDiffText(text: string): boolean {
  return /(^|\n)(?:diff --git |@@ |\*\*\* (?:Begin|Update|Add|Delete) File:)/u.test(text);
}

function splitFencedDiffs(text: string): readonly HistorySection[] {
  if (isDiffText(text)) return [{ kind: "diff", text }];
  const sections: HistorySection[] = [];
  const pattern = /```diff\s*\n([\s\S]*?)```/giu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index;
    if (index > cursor) sections.push({ kind: "text", text: text.slice(cursor, index) });
    sections.push({ kind: "diff", text: match[1] ?? "" });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) sections.push({ kind: "text", text: text.slice(cursor) });
  return sections.length === 0 ? [{ kind: "text", text }] : sections;
}

function assistantSection(item: unknown): readonly HistorySection[] {
  const type = stringField(item, "type");
  if (type === "text") {
    const text = stringField(item, "text");
    return text ? splitFencedDiffs(text) : [];
  }
  if (type === "thinking") {
    const thinking = stringField(item, "thinking");
    return thinking ? [{ kind: "thinking", text: thinking }] : [];
  }
  if (type !== "toolCall") return [];
  const summary = toolSummary(item);
  const arguments_ = isRecord(item) ? item["arguments"] : undefined;
  const details = arguments_ === undefined ? "" : `\n\n\`\`\`json\n${jsonText(arguments_)}\n\`\`\``;
  return [{ kind: "toolOutput", text: `**${summary}**${details}` }];
}

function assistantSections(content: readonly unknown[]): readonly HistorySection[] {
  return content.flatMap(assistantSection);
}

function messageTimestamp(entry: unknown, message: unknown): number | undefined {
  return numberField(message, "timestamp") ?? entryTimestamp(entry);
}

function messageContent(message: unknown): unknown {
  return isRecord(message) ? message["content"] : undefined;
}

function contentAsText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => stringField(item, "text") ?? stringField(item, "thinking") ?? "")
    .filter(Boolean)
    .join("\n\n");
}

function toolResultPresentation(entry: unknown, message: unknown): HistoryEntryPresentation {
  const text = contentAsText(messageContent(message));
  const toolName = stringField(message, "toolName") ?? "tool";
  const isError = booleanField(message, "isError") === true;
  const sectionKind: HistorySectionKind = isDiffText(text) ? "diff" : "toolOutput";
  const sections: readonly HistorySection[] = [{ kind: sectionKind, text }];
  return {
    hasDiff: sectionKind === "diff",
    hasThinking: false,
    hasToolOutput: true,
    isError,
    kind: isError ? "error" : "tool",
    label: isError ? `Tool error · ${toolName}` : `Tool result · ${toolName}`,
    searchableText: `${toolName}\n${text}`,
    sections,
    summary: text.trim().split("\n", 1)[0]?.slice(0, 240),
    timestamp: messageTimestamp(entry, message),
    toolCallId: stringField(message, "toolCallId"),
    toolName,
  };
}

function messageKind(
  role: string,
  hasToolOutput: boolean,
  hasVisibleAssistantText: boolean,
): HistoryEntryKind {
  if (role === "user") return "user";
  return hasToolOutput && !hasVisibleAssistantText ? "tool" : "assistant";
}

function messageLabel(kind: HistoryEntryKind): string {
  if (kind === "user") return "You";
  return kind === "tool" ? "Tool call" : "Assistant";
}

function firstToolCallName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content as readonly unknown[]) {
    if (stringField(item, "type") === "toolCall") return stringField(item, "name");
  }
  return undefined;
}

function messagePresentation(entry: unknown, message: unknown): HistoryEntryPresentation {
  const role = stringField(message, "role") ?? "assistant";
  if (role === "toolResult") return toolResultPresentation(entry, message);
  const content = messageContent(message);
  const sections = Array.isArray(content)
    ? assistantSections(content)
    : splitFencedDiffs(contentAsText(content));
  const hasToolOutput = sections.some((section) => section.kind === "toolOutput");
  const hasVisibleAssistantText = sections.some(
    (section) => section.kind === "text" || section.kind === "diff",
  );
  const kind = messageKind(role, hasToolOutput, hasVisibleAssistantText);
  return {
    hasDiff: sections.some((section) => section.kind === "diff"),
    hasThinking: sections.some((section) => section.kind === "thinking"),
    hasToolOutput,
    isError: false,
    kind,
    label: messageLabel(kind),
    searchableText: sections.map((section) => section.text).join("\n\n"),
    sections,
    summary: sections.find((section) => section.kind === "toolOutput")?.text,
    timestamp: messageTimestamp(entry, message),
    toolCallId: undefined,
    toolName: firstToolCallName(content),
  };
}

function nonMessageText(entry: unknown, type: string): string {
  if (type === "compaction") return stringField(entry, "summary") ?? "";
  return type === "custom_message" ? (stringField(entry, "content") ?? "") : "";
}

function nonMessagePresentation(entry: unknown): HistoryEntryPresentation {
  const type = stringField(entry, "type") ?? "entry";
  const isCompaction = type === "compaction";
  const text = nonMessageText(entry, type);
  const summary = isCompaction ? text.trim().split("\n", 1)[0]?.slice(0, 240) : undefined;
  return {
    hasDiff: false,
    hasThinking: false,
    hasToolOutput: false,
    isError: false,
    kind: isCompaction ? "compaction" : "custom",
    label: isCompaction ? "Compaction" : (stringField(entry, "customType") ?? type),
    searchableText: text,
    sections: [{ kind: "text", text }],
    summary,
    timestamp: entryTimestamp(entry),
    toolCallId: undefined,
    toolName: undefined,
  };
}

function contentItemVisibility(item: unknown): "text" | "toolCall" | undefined {
  const type = stringField(item, "type");
  if (type === "toolCall") return "toolCall";
  if (type === "text" && /\S/u.test(stringField(item, "text") ?? "")) return "text";
  return undefined;
}

function messageKindFromContent(role: string, content: unknown): HistoryEntryKind {
  if (role === "user") return "user";
  if (!Array.isArray(content)) return "assistant";
  const visibility = content.map(contentItemVisibility);
  const hasToolCall = visibility.includes("toolCall");
  return hasToolCall && !visibility.includes("text") ? "tool" : "assistant";
}

export type HistoryToolCallInfo = Readonly<{ id: string; name: string; summary: string }>;

export function historyToolCallInfos(entry: unknown): readonly HistoryToolCallInfo[] {
  const message = messageFromEntry(entry);
  if (!isRecord(message)) return [];
  const content = message["content"];
  if (!Array.isArray(content)) return [];
  const infos: HistoryToolCallInfo[] = [];
  for (const item of content) {
    if (stringField(item, "type") !== "toolCall") continue;
    const id = stringField(item, "id");
    const name = stringField(item, "name");
    if (id && name) infos.push({ id, name, summary: toolSummary(item) });
  }
  return infos;
}

export function historyEntryTimestamp(entry: unknown): number | undefined {
  const message = messageFromEntry(entry);
  if (isRecord(message)) return numberField(message, "timestamp") ?? entryTimestamp(entry);
  return entryTimestamp(entry);
}

export function historyEntryKind(entry: unknown): HistoryEntryKind {
  const message = messageFromEntry(entry);
  if (isRecord(message)) {
    const role = stringField(message, "role") ?? "assistant";
    if (role === "user") return "user";
    if (role === "toolResult") {
      return booleanField(message, "isError") === true ? "error" : "tool";
    }
    return messageKindFromContent(role, message["content"]);
  }
  return stringField(entry, "type") === "compaction" ? "compaction" : "custom";
}

export function historyEntryPresentation(entry: unknown): HistoryEntryPresentation {
  const message = messageFromEntry(entry);
  return isRecord(message) ? messagePresentation(entry, message) : nonMessagePresentation(entry);
}

export function historyKindMatchesFilter(kind: HistoryEntryKind, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "tools") return kind === "tool" || kind === "error";
  if (filter === "errors") return kind === "error";
  if (filter === "compactions") return kind === "compaction";
  return kind === filter;
}

export function historyEntryMatchesFilter(entry: unknown, filter: HistoryFilter): boolean {
  return historyKindMatchesFilter(historyEntryKind(entry), filter);
}

export function nextHistoryFilter(filter: HistoryFilter, direction = 1): HistoryFilter {
  const index = FILTER_ORDER.indexOf(filter);
  const nextIndex = (index + direction + FILTER_ORDER.length) % FILTER_ORDER.length;
  return FILTER_ORDER[nextIndex] ?? "all";
}

export function historyFilterKey(key: string): HistoryFilter | undefined {
  const byKey: Readonly<Record<string, HistoryFilter>> = {
    a: "all",
    c: "compactions",
    e: "errors",
    s: "assistant",
    t: "tools",
    u: "user",
    x: "custom",
  };
  return byKey[key];
}
