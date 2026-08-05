import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  historyEntryPresentation,
  type HistoryEntryPresentation,
  type HistorySection,
} from "./history-entry.ts";

const PREVIEW_CHARACTER_LIMIT = 4_000;
const DETAIL_CHARACTER_LIMIT = 100_000;
const DEFAULT_CACHE_LIMIT = 128;
const PREPARED_CACHE_LIMIT = 8;

export type HistoryRenderTheme = Pick<Theme, "bg" | "bold" | "fg" | "italic">;

export type HistoryRenderLocation = Readonly<{
  pageIndex: number;
  segmentIndex: number;
}>;

export type HistoryEntryDisplayState = Readonly<{
  detailed: boolean;
  showDiffs: boolean;
  showThinking: boolean;
  showToolOutput: boolean;
}>;

export const DEFAULT_HISTORY_ENTRY_DISPLAY: HistoryEntryDisplayState = {
  detailed: false,
  showDiffs: false,
  showThinking: true,
  showToolOutput: true,
};

type CachedBlock = Readonly<{ lines: readonly string[] }>;

type PreparedEntry = Readonly<{
  hasMore: boolean;
  presentation: HistoryEntryPresentation;
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

function thinkingSectionText(section: HistorySection, state: HistoryEntryDisplayState): string {
  return state.showThinking ? section.text : "*Thinking hidden · press t to show*";
}

const TOOL_PREVIEW_LINES = 5;

function stripDanglingFences(lines: readonly string[]): readonly string[] {
  const fenceCount = lines.filter((line) => line.trimStart().startsWith("```")).length;
  if (fenceCount % 2 === 0) return lines;
  return lines.filter((line) => !line.trimStart().startsWith("```"));
}

function toolSectionText(
  section: HistorySection,
  state: HistoryEntryDisplayState,
  presentation: HistoryEntryPresentation,
): string {
  if (state.showToolOutput) return section.text;
  const lines = section.text.split("\n");
  const preview = stripDanglingFences(lines.slice(0, TOOL_PREVIEW_LINES)).join("\n");
  const summary = presentation.summary?.trim().split("\n", 1)[0];
  const head = preview.trim() ? preview : (summary?.slice(0, 240) ?? "");
  const remaining = lines.length - TOOL_PREVIEW_LINES;
  if (remaining > 0) {
    return `${head}\n... (${String(remaining)} more lines, press o to expand)`;
  }
  return head;
}

function diffSectionText(section: HistorySection, state: HistoryEntryDisplayState): string {
  return state.showDiffs
    ? `\`\`\`diff\n${section.text}\n\`\`\``
    : "*Diff hidden · press d to show*";
}

function sectionText(
  section: HistorySection,
  state: HistoryEntryDisplayState,
  presentation: HistoryEntryPresentation,
): string {
  if (section.kind === "thinking") return thinkingSectionText(section, state);
  if (section.kind === "toolOutput") return toolSectionText(section, state, presentation);
  if (section.kind === "diff") return diffSectionText(section, state);
  return section.text;
}

function displayBody(
  presentation: HistoryEntryPresentation,
  state: HistoryEntryDisplayState,
): string {
  const sections: string[] = [];
  for (const section of presentation.sections) {
    const text = sectionText(section, state, presentation);
    if (!sections.includes(text) || !text.includes(" hidden · press ")) sections.push(text);
  }
  return sections.join("\n\n");
}

function boundedBody(
  body: string,
  detailed: boolean,
  pageIndex: number,
): { hasMore: boolean; text: string; truncated: boolean } {
  const limit = detailed ? DETAIL_CHARACTER_LIMIT : PREVIEW_CHARACTER_LIMIT;
  const offset = detailed ? pageIndex * limit : 0;
  const end = offset + limit;
  return {
    hasMore: detailed && body.length > end,
    text: terminalSafeHistoryText(body.slice(offset, end)),
    truncated: body.length > end || (!detailed && body.length > limit),
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

type BlockBackground = Parameters<HistoryRenderTheme["bg"]>[0];

function blockBackground(presentation: HistoryEntryPresentation): BlockBackground | undefined {
  if (presentation.kind === "user") return "userMessageBg";
  if (presentation.kind === "tool") return "toolSuccessBg";
  if (presentation.kind === "error") return "toolErrorBg";
  if (presentation.kind === "compaction" || presentation.kind === "custom") {
    return "customMessageBg";
  }
  return undefined;
}

type BlockForeground = Parameters<HistoryRenderTheme["fg"]>[0];

function blockForeground(presentation: HistoryEntryPresentation): BlockForeground | undefined {
  if (presentation.kind === "user") return "userMessageText";
  if (presentation.kind === "tool" || presentation.kind === "error") return "toolOutput";
  if (presentation.kind === "compaction" || presentation.kind === "custom") {
    return "customMessageText";
  }
  return undefined;
}

function blockLabel(
  presentation: HistoryEntryPresentation,
  theme: HistoryRenderTheme,
  callSummary: string | undefined,
): string | undefined {
  if (presentation.kind === "compaction") {
    return theme.bold(theme.fg("customMessageLabel", "[compaction]"));
  }
  if (presentation.kind === "custom") {
    const label = terminalSafeHistoryText(presentation.label);
    return theme.bold(theme.fg("customMessageLabel", `[${label}]`));
  }
  if (presentation.kind === "tool" || presentation.kind === "error") {
    const name = callSummary ?? presentation.toolName ?? "tool";
    return theme.bold(theme.fg("toolTitle", terminalSafeHistoryText(name)));
  }
  return undefined;
}

function truncationLines(
  prepared: PreparedEntry,
  width: number,
  theme: HistoryRenderTheme,
): readonly string[] {
  if (!prepared.truncated) return [];
  const message = prepared.hasMore
    ? "  … continue scrolling for more of this entry"
    : "  … press Enter to show more of this entry";
  return [truncateToWidth(theme.fg("warning", message), width)];
}

function literalHighlight(text: string, query: string, theme: HistoryRenderTheme): string {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerQuery) return text;
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const match = lowerText.indexOf(lowerQuery, cursor);
    if (match < 0) break;
    parts.push(text.slice(cursor, match));
    parts.push(theme.bg("selectedBg", text.slice(match, match + query.length)));
    cursor = match + query.length;
  }
  parts.push(text.slice(cursor));
  return parts.join("");
}

function padVisible(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…", true);
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function styleBodyLine(
  line: string,
  foreground: BlockForeground | undefined,
  theme: HistoryRenderTheme,
): string {
  return foreground === undefined ? line : theme.fg(foreground, line);
}

function styleBackgroundBlock(
  lines: readonly string[],
  width: number,
  background: BlockBackground,
  foreground: BlockForeground | undefined,
  theme: HistoryRenderTheme,
): readonly string[] {
  return lines.map((line) => {
    const styled = foreground === undefined ? line : theme.fg(foreground, line);
    return theme.bg(background, padVisible(styled, width));
  });
}

function renderedSegment(
  prepared: PreparedEntry,
  segmentIndex: number,
  pageIndex: number,
  width: number,
  theme: HistoryRenderTheme,
  query: string,
  callSummary: string | undefined,
): readonly string[] {
  const segment = prepared.segments[segmentIndex] ?? "";
  const highlighted = literalHighlight(segment, query, theme);
  const markdown = new Markdown(
    highlighted || theme.fg("dim", "[no text content]"),
    2,
    0,
    getMarkdownTheme(),
  );
  const foreground = blockForeground(prepared.presentation);
  const body = markdown.render(width).map((line) => styleBodyLine(line, foreground, theme));
  const lines = segmentLines(prepared, segmentIndex, pageIndex, body, width, theme, callSummary);
  const background = blockBackground(prepared.presentation);
  return background === undefined
    ? lines
    : styleBackgroundBlock(lines, width, background, foreground, theme);
}

function segmentLines(
  prepared: PreparedEntry,
  segmentIndex: number,
  pageIndex: number,
  body: readonly string[],
  width: number,
  theme: HistoryRenderTheme,
  callSummary: string | undefined,
): readonly string[] {
  const firstSegment = pageIndex === 0 && segmentIndex === 0;
  const lastSegment = segmentIndex === prepared.segments.length - 1;
  const label = firstSegment ? blockLabel(prepared.presentation, theme, callSummary) : undefined;
  const background = blockBackground(prepared.presentation);
  return [
    ...(firstSegment ? [""] : []),
    ...(label === undefined ? [] : [label]),
    ...body,
    ...(lastSegment ? truncationLines(prepared, width, theme) : []),
    ...(lastSegment && background !== undefined ? [""] : []),
  ];
}

function touchCache<T>(cache: Map<string, T>, key: string, value: T): T {
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function trimCache<T>(cache: Map<string, T>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (typeof oldest !== "string") break;
    cache.delete(oldest);
  }
}

function stateKey(state: HistoryEntryDisplayState): string {
  return [state.detailed, state.showThinking, state.showToolOutput, state.showDiffs]
    .map((value) => (value ? "1" : "0"))
    .join("");
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

  describe(entry: unknown): HistoryEntryPresentation {
    return historyEntryPresentation(entry);
  }

  locate(
    entry: unknown,
    width: number,
    state: HistoryEntryDisplayState,
    lineBudget: number,
    query: string,
  ): HistoryRenderLocation {
    const presentation = historyEntryPresentation(entry);
    const body = displayBody(presentation, state);
    const match = body.toLowerCase().indexOf(query.toLowerCase());
    if (match < 0) return { pageIndex: 0, segmentIndex: 0 };
    const pageIndex = state.detailed ? Math.floor(match / DETAIL_CHARACTER_LIMIT) : 0;
    const rawPageOffset = state.detailed ? match % DETAIL_CHARACTER_LIMIT : match;
    const page = boundedBody(body, state.detailed, pageIndex).text;
    const safePageOffset = terminalSafeHistoryText(
      body.slice(
        pageIndex * DETAIL_CHARACTER_LIMIT,
        pageIndex * DETAIL_CHARACTER_LIMIT + rawPageOffset,
      ),
    ).length;
    const segments = bodySegments(page, width, lineBudget);
    let consumed = 0;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      consumed += segments[segmentIndex]?.length ?? 0;
      if (safePageOffset < consumed) return { pageIndex, segmentIndex };
    }
    return { pageIndex, segmentIndex: Math.max(0, segments.length - 1) };
  }

  pageCount(entry: unknown, state: HistoryEntryDisplayState): number {
    if (!state.detailed) return 1;
    const body = displayBody(historyEntryPresentation(entry), state);
    return Math.max(1, Math.ceil(body.length / DETAIL_CHARACTER_LIMIT));
  }

  segmentCount(
    entry: unknown,
    entryIndex: number,
    width: number,
    state: HistoryEntryDisplayState,
    lineBudget: number,
    pageIndex = 0,
  ): number {
    return this.prepare(entry, entryIndex, width, state, lineBudget, pageIndex).segments.length;
  }

  hasNextPage(
    entry: unknown,
    entryIndex: number,
    width: number,
    state: HistoryEntryDisplayState,
    lineBudget: number,
    pageIndex: number,
  ): boolean {
    return this.prepare(entry, entryIndex, width, state, lineBudget, pageIndex).hasMore;
  }

  render(
    entry: unknown,
    entryIndex: number,
    width: number,
    state: HistoryEntryDisplayState,
    segmentIndex = 0,
    lineBudget = 20,
    pageIndex = 0,
    query = "",
    selected = false,
    callSummary?: string,
  ): readonly string[] {
    const safeWidth = Math.max(1, width);
    const safeBudget = Math.max(4, lineBudget);
    const key = this.renderKey(
      entryIndex,
      safeWidth,
      state,
      safeBudget,
      pageIndex,
      segmentIndex,
      query,
      selected,
      callSummary,
    );
    const cached = this.cache.get(key);
    if (cached) return touchCache(this.cache, key, cached).lines;

    const prepared = this.prepare(entry, entryIndex, safeWidth, state, safeBudget, pageIndex);
    const safeSegmentIndex = Math.min(Math.max(0, segmentIndex), prepared.segments.length - 1);
    const lines = renderedSegment(
      prepared,
      safeSegmentIndex,
      pageIndex,
      safeWidth,
      this.theme,
      query,
      callSummary,
    );
    const block = { lines };
    this.cache.set(key, block);
    trimCache(this.cache, this.cacheLimit);
    return lines;
  }

  private renderKey(
    entryIndex: number,
    width: number,
    state: HistoryEntryDisplayState,
    lineBudget: number,
    pageIndex: number,
    segmentIndex: number,
    query: string,
    selected: boolean,
    callSummary: string | undefined,
  ): string {
    const selection = selected ? "selected" : "normal";
    return `${String(entryIndex)}:${String(width)}:${stateKey(state)}:${String(lineBudget)}:${String(pageIndex)}:${String(segmentIndex)}:${query}:${selection}:${callSummary ?? ""}`;
  }

  private prepare(
    entry: unknown,
    entryIndex: number,
    width: number,
    state: HistoryEntryDisplayState,
    lineBudget: number,
    pageIndex: number,
  ): PreparedEntry {
    const key = `${String(entryIndex)}:${String(width)}:${stateKey(state)}:${String(lineBudget)}:${String(pageIndex)}`;
    const cached = this.prepared.get(key);
    if (cached) return touchCache(this.prepared, key, cached);
    const presentation = historyEntryPresentation(entry);
    const body = boundedBody(displayBody(presentation, state), state.detailed, pageIndex);
    const prepared = {
      hasMore: body.hasMore,
      presentation,
      segments: bodySegments(body.text, width, lineBudget),
      truncated: body.truncated,
    };
    this.prepared.set(key, prepared);
    trimCache(this.prepared, Math.min(this.cacheLimit, PREPARED_CACHE_LIMIT));
    return prepared;
  }
}
