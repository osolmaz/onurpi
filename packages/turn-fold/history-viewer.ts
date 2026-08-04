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
import { HistoryViewport } from "./history-viewport.ts";

const SEARCH_STEP_ENTRIES = 250;
const SEARCH_STEP_CHARACTERS = 256_000;

type ExplorerMode = "browse" | "filter" | "help" | "jump" | "search";
type ExplorerTui = Pick<TUI, "requestRender" | "terminal">;

export type HistoryExplorerLifecycle = Readonly<{
  closed: () => void;
  opened: (close: () => void) => void;
}>;

function padLine(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…", true);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

function helpLines(): readonly string[] {
  return [
    "Navigation",
    "  ↑/↓ or Ctrl+P/Ctrl+N   one line",
    "  b / Space              one screen back / forward",
    "  g / G                  oldest admitted / newest",
    "  [ / ]                  previous / next jump position",
    "",
    "Find and narrow",
    "  /                      edit search",
    "  n / N                  next / previous match",
    "  f                      filter menu",
    "  j                      jump menu",
    "",
    "Current entry",
    "  Enter                  long text details",
    "  T                      thinking",
    "  O                      tool output or arguments",
    "  D                      diff output",
    "",
    "Overlay",
    "  ?                      close help",
    "  q / Esc                close or return",
    "  Ctrl+Shift+O           close from any screen",
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
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+shift+o")) {
      this.close();
      return;
    }
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
    const innerWidth = width - 2;
    const overlayHeight = this.overlayHeight();
    const contentHeight = this.contentHeight(overlayHeight);
    const body = this.renderBody(innerWidth, contentHeight);
    const border = this.theme.fg("border", `+${"-".repeat(innerWidth)}+`);
    const row = (content: string) =>
      `${this.theme.fg("border", "|")}${padLine(content, innerWidth)}${this.theme.fg("border", "|")}`;
    const lines =
      overlayHeight >= 6
        ? [
            border,
            row(this.title()),
            row(this.status()),
            row(this.theme.fg("border", "-".repeat(innerWidth))),
            ...body.map(row),
            border,
          ]
        : [border, row(this.title()), ...body.map(row), border];
    return lines.slice(0, overlayHeight);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = undefined;
    this.closeCallback();
  }

  private handleBrowseInput(data: string): void {
    this.statusMessage = "";
    if (this.handleCloseOrSearchClear(data)) return;
    if (this.handleModeOpen(data)) return;
    if (this.handleSearchNavigation(data)) return;
    if (this.handleHistoryNavigation(data)) return;
    if (this.handleMovement(data)) return;
    if (this.handleEntryControl(data)) return;
  }

  private handleModeOpen(data: string): boolean {
    if (data === "?") {
      this.mode = "help";
    } else if (data === "/") {
      this.mode = "search";
      this.input = new HistoryInput(this.search.query);
    } else if (data === "f") {
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
      this.requestRender();
    }
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
    if (!this.search.query || (data !== "n" && data !== "N")) return false;
    const direction: 1 | -1 = data === "n" ? 1 : -1;
    const match = this.search.next(this.viewport.currentEntryIndex, direction);
    if (!match) {
      this.statusMessage = this.search.complete ? "No matches." : "Search is still scanning.";
    } else {
      this.viewport.jumpToMatch(match);
      this.searchSelected = true;
    }
    this.requestRender();
    return true;
  }

  private handleHistoryNavigation(data: string): boolean {
    if (data === "[") {
      this.statusMessage = this.viewport.goBack() ? "Moved back." : "No earlier jump position.";
      this.requestRender();
      return true;
    }
    if (data === "]") {
      this.statusMessage = this.viewport.goForward() ? "Moved forward." : "No later jump position.";
      this.requestRender();
      return true;
    }
    return false;
  }

  private handleMovement(data: string): boolean {
    return (
      this.handleLineMovement(data) ||
      this.handleScreenMovement(data) ||
      this.handleBoundaryMovement(data)
    );
  }

  private handleLineMovement(data: string): boolean {
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
      this.viewport.moveBackward(1);
    } else if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
      this.viewport.moveForward(1);
    } else {
      return false;
    }
    this.requestRender();
    return true;
  }

  private handleScreenMovement(data: string): boolean {
    const height = Math.max(1, this.contentHeight(this.overlayHeight()));
    if (data === "b" || matchesKey(data, "pageUp")) {
      this.viewport.moveBackward(height);
    } else if (matchesKey(data, "space") || matchesKey(data, "pageDown")) {
      this.viewport.moveForward(height);
    } else {
      return false;
    }
    this.requestRender();
    return true;
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
    let changed = false;
    if (matchesKey(data, "enter")) changed = this.viewport.toggleDetails();
    else if (data === "T") changed = this.viewport.toggleThinking();
    else if (data === "O") changed = this.viewport.toggleToolOutput();
    else if (data === "D") changed = this.viewport.toggleDiffs();
    else return false;
    this.statusMessage = changed ? "Entry display updated." : "That section is unavailable.";
    this.requestRender();
    return true;
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
    if (target.kind === "match") {
      const match = this.search.results[target.number - 1];
      if (match) this.viewport.jumpToMatch(match);
    } else {
      this.viewport.jumpToEntry(result.entryIndex);
    }
    this.statusMessage = `Jumped to ${result.label}.`;
  }

  private renderBody(width: number, height: number): readonly string[] {
    if (this.mode === "help") return helpLines().slice(0, height);
    if (this.mode === "filter") return filterLines(this.viewport.filter).slice(0, height);
    if (this.mode === "jump") return this.jumpLines().slice(0, height);
    return this.viewport.render(width, Math.max(1, height)).slice(0, height);
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
        ` Turn Fold · ${String(this.viewport.admittedWindows)} of ${String(this.viewport.totalWindows)} windows · w ${String(context.windowNumber)}/${String(context.totalWindows)} · e ${String(context.entryIndex + 1)}/${String(context.totalEntries)} · ${context.presentation.label}${time}`,
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
    return ` filter ${this.viewport.filter} · back ${String(navigation.back)} · forward ${String(navigation.forward)} · / search · f filter · j jump · ? help`;
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
    const terminalRows = Math.max(1, this.tui.terminal.rows);
    const availableRows = Math.max(1, terminalRows - 2);
    return Math.min(availableRows, Math.max(1, Math.floor(terminalRows * 0.95)));
  }

  private contentHeight(overlayHeight: number): number {
    return Math.max(0, overlayHeight - (overlayHeight >= 6 ? 5 : 3));
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
          margin: 1,
          maxHeight: "95%",
          width: "100%",
        },
      },
    );
  } finally {
    lifecycle?.closed();
  }
}
