import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import { historyFilterKey, type HistoryFilter } from "./history-entry.ts";
import { HistoryInput } from "./history-input.ts";
import { HistoryJumpIndex, parseHistoryJump } from "./history-navigation.ts";
import { formatLocalTimestamp } from "./local-time.ts";
import { HistorySearch } from "./history-search.ts";
import type { HistoryRenderTheme } from "./history-renderer.ts";
import { terminalSafeHistoryText } from "./history-renderer.ts";
import { HistoryViewport } from "./history-viewport.ts";

const SEARCH_STEP_ENTRIES = 250;
const SEARCH_STEP_CHARACTERS = 256_000;
const WHEEL_SCROLL_LINES = 3;
const MOUSE_ENABLE_SEQUENCE = "\u001b[?1002h\u001b[?1006h";
const MOUSE_DISABLE_SEQUENCE = "\u001b[?1002l\u001b[?1006l";
const MOUSE_PREFIX = "\u001b[<";

type ExplorerMode = "browse" | "filter" | "help" | "jump" | "search";
type ExplorerTui = Pick<TUI, "mode" | "requestRender"> & {
  readonly terminal: Pick<TUI["terminal"], "rows" | "write">;
};

function mouseEventCode(data: string): string | undefined {
  if (!data.startsWith(MOUSE_PREFIX) || data.length < 7 || !data.endsWith("M")) return undefined;
  const fields = data.slice(MOUSE_PREFIX.length, -1).split(";");
  if (fields.length !== 3 || fields.some((field) => !/^\d+$/u.test(field))) return undefined;
  return fields[0];
}

function wheelDirection(data: string): -1 | 1 | undefined {
  const code = mouseEventCode(data);
  if (code === "64") return -1;
  return code === "65" ? 1 : undefined;
}

export type HistoryExplorerLifecycle = Readonly<{
  closed: () => void;
  opened: (close: () => void) => void;
}>;

function padLine(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…", true);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function padRows(rows: readonly string[], height: number): readonly string[] {
  if (rows.length >= height) return rows;
  return [...rows, ...Array.from({ length: height - rows.length }, () => "")];
}

function helpLines(): readonly string[] {
  return [
    "Navigation",
    "  ↑/↓ or b/f or C-p/C-n  one line back / forward",
    "  ←/→ or p/n or Space    one page back / forward",
    "  [ / ]                  previous / next entry",
    "  { / }                  previous / next user message",
    "  Tab / Shift+Tab        forward / back in jump history",
    "  g / G                  oldest admitted / newest",
    "",
    "Find and narrow",
    "  /                      edit search",
    "  n / N                  next / previous match, while searching",
    "  F                      filter menu",
    "  j                      jump menu",
    "",
    "Current entry",
    "  Enter                  long text details",
    "  t / o / d              thinking / tool output / diffs, this entry",
    "  T / O / D              same sections, all entries",
    "",
    "Overlay",
    "  ?                      close help",
    "  q / Esc                close or return",
    "  Ctrl+Shift+O           close from any screen",
    "  Mouse wheel            scroll lines",
  ];
}

function filterLines(active: HistoryFilter): readonly string[] {
  return [
    `Filter · current ${active}`,
    "",
    "  a  all entries",
    "  u  user messages",
    "  s  assistant messages",
    "  t  tools and tool errors",
    "  e  errors only",
    "  c  compactions",
    "  x  custom rows",
    "",
    "Esc or q returns without changing the filter.",
  ];
}

export class HistoryExplorer implements Component {
  private closed = false;
  private readonly closeCallback: () => void;
  private input: HistoryInput | undefined;
  private jumpIndex: HistoryJumpIndex | undefined;
  private mode: ExplorerMode = "browse";
  private helpScroll = 0;
  private ownsMouseTracking = false;
  private readonly search: HistorySearch;
  private searchSelected = false;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private statusMessage = "";
  private readonly theme: HistoryRenderTheme;
  private readonly tui: ExplorerTui;
  private readonly viewport: HistoryViewport;

  constructor(
    tui: ExplorerTui,
    theme: HistoryRenderTheme,
    entries: readonly unknown[],
    close: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.closeCallback = close;
    this.viewport = new HistoryViewport(entries, theme);
    this.search = new HistorySearch(this.viewport.entries);
    this.acquireMouseTracking();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+shift+o")) {
      this.close();
      return;
    }
    if (this.handleMouseInput(data)) return;
    if (this.mode === "help") {
      this.handleHelpInput(data);
      return;
    }
    if (this.mode === "filter") {
      this.handleFilterInput(data);
      return;
    }
    if (this.mode === "search" || this.mode === "jump") {
      this.handleTextInput(data);
      return;
    }
    this.handleBrowseInput(data);
  }

  invalidate(): void {
    this.viewport.invalidate();
  }

  render(width: number): string[] {
    if (width < 4) return ["".padEnd(Math.max(0, width))];
    const overlayHeight = this.overlayHeight();
    const contentHeight = this.contentHeight(overlayHeight);
    const body = this.renderBody(width, contentHeight);
    const row = (content: string) => padLine(content, width);
    const lines =
      overlayHeight >= 4
        ? [
            row(this.title()),
            row(this.status()),
            row(this.theme.fg("border", "-".repeat(width))),
            ...body.map(row),
          ]
        : [row(this.title()), ...body.map(row)];
    return lines.slice(0, overlayHeight);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.releaseMouseTracking();
    this.closeCallback();
  }

  private acquireMouseTracking(): void {
    if (this.tui.mode !== "regular" || this.ownsMouseTracking) return;
    this.ownsMouseTracking = true;
    this.tui.terminal.write(MOUSE_ENABLE_SEQUENCE);
  }

  private releaseMouseTracking(): void {
    if (!this.ownsMouseTracking) return;
    this.ownsMouseTracking = false;
    this.tui.terminal.write(MOUSE_DISABLE_SEQUENCE);
  }

  private handleMouseInput(data: string): boolean {
    const direction = wheelDirection(data);
    if (direction === undefined) return false;
    if (this.mode === "help") {
      const limit = Math.max(0, helpLines().length - 1);
      this.helpScroll = Math.min(
        limit,
        Math.max(0, this.helpScroll + direction * WHEEL_SCROLL_LINES),
      );
      this.requestRender();
      return true;
    }
    if (this.mode !== "browse") return true;
    if (direction < 0) this.viewport.moveBackward(WHEEL_SCROLL_LINES);
    else this.viewport.moveForward(WHEEL_SCROLL_LINES);
    this.requestRender();
    return true;
  }

  private handleBrowseInput(data: string): void {
    this.statusMessage = "";
    if (this.handleCloseOrSearchClear(data)) return;
    if (this.handleModeOpen(data)) return;
    if (this.handleSearchNavigation(data)) return;
    if (this.handleHistoryNavigation(data)) return;
    if (this.handleHopNavigation(data)) return;
    if (this.handleMovement(data)) return;
    if (this.handleEntryControl(data)) return;
  }

  private handleModeOpen(data: string): boolean {
    if (data === "?") {
      this.mode = "help";
    } else if (data === "/") {
      this.mode = "search";
      this.input = new HistoryInput(this.search.query);
    } else if (data === "F") {
      this.mode = "filter";
    } else if (data === "j") {
      this.mode = "jump";
      this.input = new HistoryInput();
      this.jumpIndex ??= new HistoryJumpIndex(this.viewport.index);
    } else {
      return false;
    }
    this.requestRender();
    return true;
  }

  private handleCloseOrSearchClear(data: string): boolean {
    if (matchesKey(data, "escape") && this.search.query) {
      this.cancelSearch();
      return true;
    }
    if (matchesKey(data, "escape") || data === "q") {
      this.close();
      return true;
    }
    return false;
  }

  private handleHelpInput(data: string): void {
    if (data === "?" || data === "q" || matchesKey(data, "escape")) {
      this.mode = "browse";
      this.helpScroll = 0;
      this.requestRender();
      return;
    }
    const delta = this.helpScrollDelta(data);
    if (delta === 0) return;
    const limit = Math.max(0, helpLines().length - 1);
    this.helpScroll = Math.min(limit, Math.max(0, this.helpScroll + delta));
    this.requestRender();
  }

  private helpScrollDelta(data: string): number {
    const line = this.helpLineDelta(data);
    if (line !== 0) return line;
    return this.helpPageDelta(data);
  }

  private helpLineDelta(data: string): number {
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || data === "b") return -1;
    if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || data === "f") return 1;
    return 0;
  }

  private helpPageDelta(data: string): number {
    const page = Math.max(1, this.contentHeight(this.overlayHeight()));
    if (data === "p" || matchesKey(data, "left") || matchesKey(data, "pageUp")) return -page;
    if (data === "n" || matchesKey(data, "right") || matchesKey(data, "pageDown")) return page;
    return 0;
  }

  private handleFilterInput(data: string): void {
    if (data === "q" || matchesKey(data, "escape")) {
      this.mode = "browse";
      this.requestRender();
      return;
    }
    const filter = historyFilterKey(data);
    if (!filter) return;
    this.viewport.setFilter(filter);
    this.mode = "browse";
    this.statusMessage = `Filter: ${filter}`;
    if (this.search.query) this.startSearch(this.search.query);
    this.requestRender();
  }

  private handleTextInput(data: string): void {
    const input = this.input;
    if (!input) return;
    const action = input.handle(data);
    if (action === "cancel") {
      this.input = undefined;
      this.mode = "browse";
      this.requestRender();
      return;
    }
    if (action === "submit") {
      const value = input.text;
      const mode = this.mode;
      this.input = undefined;
      this.mode = "browse";
      if (mode === "search") this.startSearch(value);
      else this.submitJump(value);
      this.requestRender();
      return;
    }
    if (action === "changed") this.requestRender();
  }

  private handleSearchNavigation(data: string): boolean {
    if (!this.search.query) return false;
    if (data !== "n" && data !== "N") return false;
    const direction: 1 | -1 = data === "n" ? 1 : -1;
    const match = this.search.next(this.viewport.currentEntryIndex, direction);
    if (!match) {
      this.statusMessage = this.search.complete ? "No matches." : "Search is still scanning.";
    } else {
      const jump = this.viewport.jumpToMatch(match);
      this.searchSelected = true;
      if (jump.filterReset) this.startSearch(this.search.query);
    }
    this.requestRender();
    return true;
  }

  private handleHistoryNavigation(data: string): boolean {
    if (matchesKey(data, "tab")) {
      this.statusMessage = this.viewport.goForward() ? "Moved forward." : "No later jump position.";
      this.requestRender();
      return true;
    }
    if (matchesKey(data, "shift+tab")) {
      this.statusMessage = this.viewport.goBack() ? "Moved back." : "No earlier jump position.";
      this.requestRender();
      return true;
    }
    return false;
  }

  private handleHopNavigation(data: string): boolean {
    if (data === "[" || data === "]") return this.hop(data === "[" ? -1 : 1, false);
    if (data === "{" || data === "}") return this.hop(data === "{" ? -1 : 1, true);
    return false;
  }

  private hop(direction: -1 | 1, userOnly: boolean): boolean {
    const jump = userOnly
      ? this.viewport.hopUserMessage(direction)
      : this.viewport.hopEntry(direction);
    if (!jump.moved) {
      this.statusMessage = "No further message in that direction.";
    } else {
      this.statusMessage = userOnly
        ? "Hopped to the neighboring user message."
        : "Hopped to the neighboring entry.";
    }
    if (jump.filterReset && this.search.query) this.startSearch(this.search.query);
    this.requestRender();
    return true;
  }

  private handleMovement(data: string): boolean {
    return (
      this.handleLineMovement(data) ||
      this.handleScreenMovement(data) ||
      this.handleBoundaryMovement(data)
    );
  }

  private handleLineMovement(data: string): boolean {
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || data === "b") {
      this.viewport.moveBackward(1);
    } else if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || data === "f") {
      this.viewport.moveForward(1);
    } else {
      return false;
    }
    this.requestRender();
    return true;
  }

  private handleScreenMovement(data: string): boolean {
    const height = Math.max(1, this.contentHeight(this.overlayHeight()));
    if (data === "p" || matchesKey(data, "left") || matchesKey(data, "pageUp")) {
      this.viewport.moveBackward(height);
    } else if (this.pageForwardKey(data)) {
      this.viewport.moveForward(height);
    } else {
      return false;
    }
    this.requestRender();
    return true;
  }

  private pageForwardKey(data: string): boolean {
    if (matchesKey(data, "space") || matchesKey(data, "right") || matchesKey(data, "pageDown")) {
      return true;
    }
    return data === "n" && !this.search.query;
  }

  private handleBoundaryMovement(data: string): boolean {
    if (data === "G" || matchesKey(data, "shift+g")) {
      this.viewport.moveToNewest(true);
    } else if (data === "g") {
      this.viewport.moveToOldest(true);
    } else {
      return false;
    }
    this.requestRender();
    return true;
  }

  private handleEntryControl(data: string): boolean {
    const message = this.handleSingleEntryControl(data) ?? this.handleAllEntryControl(data);
    if (message === undefined && !this.isEntryControlKey(data)) return false;
    this.statusMessage = message ?? "That section is unavailable on this entry.";
    this.requestRender();
    return true;
  }

  private isEntryControlKey(data: string): boolean {
    return matchesKey(data, "enter") || "tToOdD".includes(data);
  }

  private handleSingleEntryControl(data: string): string | undefined {
    if (matchesKey(data, "enter")) {
      return this.viewport.toggleDetails() ? "Entry detail toggled." : undefined;
    }
    return this.singleSectionControl(data);
  }

  private singleSectionControl(data: string): string | undefined {
    if (data === "t") {
      return this.viewport.toggleThinking() ? "Entry thinking toggled." : undefined;
    }
    if (data === "o") {
      return this.viewport.toggleToolOutput() ? "Entry tool output toggled." : undefined;
    }
    if (data === "d") {
      return this.viewport.toggleDiffs() ? "Entry diffs toggled." : undefined;
    }
    return undefined;
  }

  private handleAllEntryControl(data: string): string | undefined {
    if (data === "T") {
      this.viewport.toggleAllThinking();
      return "Thinking toggled for all entries.";
    }
    if (data === "O") {
      this.viewport.toggleAllToolOutput();
      return "Tool output toggled for all entries.";
    }
    if (data === "D") {
      this.viewport.toggleAllDiffs();
      return "Diffs toggled for all entries.";
    }
    return undefined;
  }

  private startSearch(query: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.searchSelected = false;
    this.viewport.setSearch(query.trim());
    this.search.start(query, this.viewport.filter);
    if (!this.search.query) {
      this.statusMessage = "Search cleared.";
      return;
    }
    this.statusMessage = `Searching for “${this.search.query}”…`;
    this.scheduleSearch();
  }

  private scheduleSearch(): void {
    if (this.closed || this.search.complete || this.searchTimer) return;
    this.searchTimer = setTimeout(() => {
      this.searchTimer = undefined;
      this.search.step(SEARCH_STEP_ENTRIES, SEARCH_STEP_CHARACTERS);
      if (!this.searchSelected && this.search.results[0]) {
        this.viewport.jumpToMatch(this.search.results[0]);
        this.searchSelected = true;
      }
      if (this.search.complete) {
        this.statusMessage = this.search.results.length === 0 ? "No matches." : "Search complete.";
      }
      this.requestRender();
      this.scheduleSearch();
    }, 0);
  }

  private cancelSearch(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.search.clear();
    this.viewport.clearSearch();
    this.searchSelected = false;
    this.statusMessage = "Search cleared.";
    this.requestRender();
  }

  private submitJump(value: string): void {
    const target = parseHistoryJump(value);
    if (!target) {
      this.statusMessage = "Jump format is invalid. Press j for examples.";
      return;
    }
    const jumps = (this.jumpIndex ??= new HistoryJumpIndex(this.viewport.index));
    const result = jumps.resolve(target, this.search.results);
    if (!result.ok) {
      this.statusMessage = result.error;
      return;
    }
    let filterReset = false;
    if (target.kind === "match") {
      const match = this.search.results[target.number - 1];
      if (match) filterReset = this.viewport.jumpToMatch(match).filterReset;
    } else {
      filterReset = this.viewport.jumpToEntry(result.entryIndex).filterReset;
    }
    this.statusMessage = `Jumped to ${result.label}.`;
    if (filterReset && this.search.query) this.startSearch(this.search.query);
  }

  private renderBody(width: number, height: number): readonly string[] {
    const safeHeight = Math.max(1, height);
    if (this.mode === "help") {
      const all = helpLines();
      const start = Math.min(this.helpScroll, Math.max(0, all.length - safeHeight));
      return padRows(all.slice(start, start + safeHeight), safeHeight);
    }
    if (this.mode === "filter") {
      return padRows(filterLines(this.viewport.filter).slice(0, safeHeight), safeHeight);
    }
    if (this.mode === "jump") return padRows(this.jumpLines().slice(0, safeHeight), safeHeight);
    return this.viewport.render(width, safeHeight).slice(0, safeHeight);
  }

  private jumpLines(): readonly string[] {
    const jumps = (this.jumpIndex ??= new HistoryJumpIndex(this.viewport.index));
    return [
      "Jump target",
      "",
      `  wN  window 1–${String(this.viewport.totalWindows)}`,
      `  tN  user turn 1–${String(jumps.totalTurns)}`,
      `  mN  search match 1–${String(this.search.results.length)}`,
      "  @HH:MM or @timestamp",
      "  oldest / newest",
      "",
      "Enter jumps. Esc cancels.",
    ];
  }

  private title(): string {
    const context = this.viewport.context();
    if (!context) {
      return this.theme.bold(
        this.theme.fg(
          "accent",
          ` Turn Fold history · ${String(this.viewport.admittedWindows)} of ${String(this.viewport.totalWindows)} windows`,
        ),
      );
    }
    const timestamp = context.presentation.timestamp;
    const time = timestamp === undefined ? "" : ` · ${formatLocalTimestamp(timestamp)}`;
    return this.theme.bold(
      this.theme.fg(
        "accent",
        ` Turn Fold · ${String(this.viewport.admittedWindows)} of ${String(this.viewport.totalWindows)} windows · w ${String(context.windowNumber)}/${String(context.totalWindows)} · e ${String(context.entryIndex + 1)}/${String(context.totalEntries)} · ${terminalSafeHistoryText(context.presentation.label)}${time}`,
      ),
    );
  }

  private status(): string {
    const editing = this.editingStatus();
    if (editing) return this.theme.fg("accent", editing);
    if (this.mode === "help") return this.theme.fg("dim", " Help · ?/q/Esc returns");
    if (this.mode === "filter") return this.theme.fg("dim", " Choose a filter key · q/Esc returns");
    const browse = this.browseStatus();
    const message = this.statusMessage ? ` ${this.statusMessage} ·${browse}` : browse;
    return this.theme.fg("dim", `${this.searchStatus()}${message}`);
  }

  private editingStatus(): string | undefined {
    if (!this.input) return undefined;
    if (this.mode === "search") return ` Search: ${this.input.cursorText()}`;
    return this.mode === "jump" ? ` Jump: ${this.input.cursorText()}` : undefined;
  }

  private browseStatus(): string {
    const navigation = this.viewport.navigationCounts;
    return ` filter ${this.viewport.filter} · back ${String(navigation.back)} · forward ${String(navigation.forward)} · / search · F filter · j jump · ? help`;
  }

  private searchStatus(): string {
    if (!this.search.query) return "";
    const progress = this.search.progress;
    const entryIndex = this.viewport.currentEntryIndex;
    const selected = entryIndex === undefined ? undefined : this.search.ordinal(entryIndex);
    const ordinal = selected === undefined ? "" : `${String(selected)}/`;
    const scanning = progress.complete
      ? ""
      : ` · ${String(progress.scannedEntries)}/${String(progress.totalEntries)}`;
    return ` · search “${this.search.query}” ${ordinal}${String(progress.matchedEntries)}${scanning}`;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private overlayHeight(): number {
    return Math.max(1, this.tui.terminal.rows);
  }

  private contentHeight(overlayHeight: number): number {
    return Math.max(0, overlayHeight - (overlayHeight >= 4 ? 3 : 1));
  }
}

export async function showHistoryExplorer(
  ctx: ExtensionCommandContext,
  entries: readonly unknown[],
  lifecycle?: HistoryExplorerLifecycle,
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Turn Fold history is available only in TUI mode.", "warning");
    return;
  }
  try {
    await ctx.ui.custom<undefined>(
      (tui, theme, _keybindings, done) => {
        const explorer = new HistoryExplorer(tui, theme, entries, () => {
          done(undefined);
        });
        lifecycle?.opened(() => {
          explorer.close();
        });
        return explorer;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "center",
          margin: 0,
          maxHeight: "100%",
          width: "100%",
        },
      },
    );
  } finally {
    lifecycle?.closed();
  }
}
