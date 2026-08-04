import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth } from "@earendil-works/pi-tui";

import { formatLocalTimestamp } from "./local-time.ts";
import {
  entryTimestamp,
  isRecord,
  messageFromEntry,
  numberField,
  stringField,
} from "./turn-message.ts";

const PREVIEW_CHARACTER_LIMIT = 4_000;
const DETAIL_CHARACTER_LIMIT = 100_000;
const DEFAULT_CACHE_LIMIT = 128;

export type HistoryRenderTheme = Pick<Theme, "bold" | "fg">;

type PresentedEntry = Readonly<{
  body: string;
  label: string;
  timestamp: number | undefined;
}>;

type CachedBlock = Readonly<{
  lines: readonly string[];
}>;

type PreparedEntry = Readonly<{
  presented: PresentedEntry;
  segments: readonly string[];
  truncated: boolean;
}>;

export function terminalSafeHistoryText(value: string): string {
  let safe = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x08 ||
        (codePoint >= 0x0b && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      safe += `\\x${codePoint.toString(16).padStart(2, "0")}`;
    } else {
      safe += character;
    }
  }
  return safe;
}

function contentSection(item: unknown): string | undefined {
  const type = stringField(item, "type");
  if (type === "text") return stringField(item, "text");
  if (type === "thinking") {
    const thinking = stringField(item, "thinking");
    return thinking ? `*Thinking*\n\n${thinking}` : undefined;
  }
  if (type === "toolCall") return `**Tool:** ${stringField(item, "name") ?? "unknown"}`;
  return undefined;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map(contentSection)
    .filter((section) => section !== undefined)
    .join("\n\n");
}

function messageTimestamp(entry: unknown, message: unknown): number | undefined {
  return numberField(message, "timestamp") ?? entryTimestamp(entry);
}

function messageEntry(entry: unknown, message: unknown): PresentedEntry {
  const role = stringField(message, "role") ?? "message";
  const toolName = stringField(message, "toolName");
  return {
    body: isRecord(message) ? contentText(message["content"]) : "",
    label: role === "toolResult" && toolName ? `tool result · ${toolName}` : role,
    timestamp: messageTimestamp(entry, message),
  };
}

function nonMessageEntry(entry: unknown, type: string): PresentedEntry {
  if (type === "compaction") {
    return {
      body: stringField(entry, "summary") ?? "",
      label: "compaction",
      timestamp: entryTimestamp(entry),
    };
  }
  return {
    body: type === "custom_message" ? (stringField(entry, "content") ?? "") : "",
    label: stringField(entry, "customType") ?? type,
    timestamp: entryTimestamp(entry),
  };
}

function presentEntry(entry: unknown): PresentedEntry {
  const message = messageFromEntry(entry);
  if (isRecord(message)) return messageEntry(entry, message);
  return nonMessageEntry(entry, stringField(entry, "type") ?? "entry");
}

function boundedBody(body: string, detailed: boolean): { text: string; truncated: boolean } {
  const limit = detailed ? DETAIL_CHARACTER_LIMIT : PREVIEW_CHARACTER_LIMIT;
  return {
    text: terminalSafeHistoryText(body.slice(0, limit)),
    truncated: body.length > limit,
  };
}

function nextSegmentEnd(
  body: string,
  start: number,
  characterLimit: number,
  lineLimit: number,
): number {
  let end = Math.min(body.length, start + characterLimit);
  let newlines = 0;
  for (let index = start; index < end; index += 1) {
    if (body[index] !== "\n") continue;
    newlines += 1;
    if (newlines < lineLimit) continue;
    end = index + 1;
    break;
  }
  const finalCodeUnit = body.charCodeAt(end - 1);
  if (end < body.length && finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return end <= start ? Math.min(body.length, start + 1) : end;
}

function bodySegments(body: string, width: number, lineBudget: number): readonly string[] {
  if (!body) return [""];
  const characterLimit = Math.max(8, Math.floor((Math.max(1, width - 2) * lineBudget) / 2));
  const lineLimit = Math.max(1, Math.floor(lineBudget / 2));
  const segments: string[] = [];
  let start = 0;
  while (start < body.length) {
    const end = nextSegmentEnd(body, start, characterLimit, lineLimit);
    segments.push(body.slice(start, end));
    start = end;
  }
  return segments;
}

function blockHeader(entry: PresentedEntry, width: number, theme: HistoryRenderTheme): string {
  const timestamp = entry.timestamp === undefined ? "" : formatLocalTimestamp(entry.timestamp);
  const suffix = timestamp ? `  ${theme.fg("dim", timestamp)}` : "";
  const label = terminalSafeHistoryText(entry.label);
  return truncateToWidth(`  ${theme.bold(theme.fg("accent", label))}${suffix}`, width);
}

function renderedSegment(
  prepared: PreparedEntry,
  segmentIndex: number,
  width: number,
  theme: HistoryRenderTheme,
): readonly string[] {
  const segment = prepared.segments[segmentIndex] ?? "";
  const markdown = new Markdown(
    segment || theme.fg("dim", "[no text content]"),
    2,
    0,
    getMarkdownTheme(),
  );
  return [
    ...(segmentIndex === 0 ? [blockHeader(prepared.presented, width, theme)] : []),
    ...markdown.render(width),
    ...(prepared.truncated && segmentIndex === prepared.segments.length - 1
      ? [truncateToWidth(theme.fg("warning", "  … press Enter to show more of this entry"), width)]
      : []),
    ...(segmentIndex === prepared.segments.length - 1 ? [""] : []),
  ];
}

export class HistoryEntryRenderer {
  private readonly cache = new Map<string, CachedBlock>();
  private readonly cacheLimit: number;
  private readonly prepared = new Map<string, PreparedEntry>();
  private readonly theme: HistoryRenderTheme;

  constructor(theme: HistoryRenderTheme, cacheLimit = DEFAULT_CACHE_LIMIT) {
    this.theme = theme;
    this.cacheLimit = Math.max(1, Math.floor(cacheLimit));
  }

  get cachedBlocks(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
    this.prepared.clear();
  }

  segmentCount(
    entry: unknown,
    entryIndex: number,
    width: number,
    detailed: boolean,
    lineBudget: number,
  ): number {
    return this.prepare(entry, entryIndex, width, detailed, lineBudget).segments.length;
  }

  render(
    entry: unknown,
    entryIndex: number,
    width: number,
    detailed: boolean,
    segmentIndex = 0,
    lineBudget = 20,
  ): readonly string[] {
    const safeWidth = Math.max(1, width);
    const safeBudget = Math.max(4, lineBudget);
    const prepared = this.prepare(entry, entryIndex, safeWidth, detailed, safeBudget);
    const safeSegmentIndex = Math.min(Math.max(0, segmentIndex), prepared.segments.length - 1);
    const key = `${String(entryIndex)}:${String(safeWidth)}:${detailed ? "detail" : "preview"}:${String(safeBudget)}:${String(safeSegmentIndex)}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.lines;
    }

    const lines = renderedSegment(prepared, safeSegmentIndex, safeWidth, this.theme);
    const block = { lines };
    this.cache.set(key, block);
    while (this.cache.size > this.cacheLimit) {
      const oldest = this.cache.keys().next().value;
      if (typeof oldest !== "string") break;
      this.cache.delete(oldest);
    }
    return lines;
  }

  private prepare(
    entry: unknown,
    entryIndex: number,
    width: number,
    detailed: boolean,
    lineBudget: number,
  ): PreparedEntry {
    const key = `${String(entryIndex)}:${String(width)}:${detailed ? "detail" : "preview"}:${String(lineBudget)}`;
    const cached = this.prepared.get(key);
    if (cached) {
      this.prepared.delete(key);
      this.prepared.set(key, cached);
      return cached;
    }
    const presented = presentEntry(entry);
    const body = boundedBody(presented.body, detailed);
    const prepared = {
      presented,
      segments: bodySegments(body.text, width, lineBudget),
      truncated: body.truncated,
    };
    this.prepared.set(key, prepared);
    const preparedLimit = Math.min(this.cacheLimit, 8);
    while (this.prepared.size > preparedLimit) {
      const oldest = this.prepared.keys().next().value;
      if (typeof oldest !== "string") break;
      this.prepared.delete(oldest);
    }
    return prepared;
  }
}
