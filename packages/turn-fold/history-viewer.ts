import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";

import { createHistoryIndex, HistoryRange } from "./history-index.ts";
import { HistoryEntryRenderer } from "./history-renderer.ts";

type HistoryPosition = Readonly<{
  entryIndex: number;
  lineOffset: number;
}>;

type ExplorerTui = Pick<TUI, "requestRender" | "terminal">;

export type HistoryExplorerLifecycle = Readonly<{
  closed: () => void;
  opened: (close: () => void) => void;
}>;

function padLine(value: string, width: number): string {
  const truncated = truncateToWidth(value, width, "…", true);
  return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
}

export class HistoryViewport {
  private readonly detailedEntries = new Set<number>();
  private readonly range: HistoryRange;
  private readonly renderer: HistoryEntryRenderer;
  private top: HistoryPosition | undefined;
  private viewportHeight = 1;
  private width = 1;

  constructor(entries: readonly unknown[], theme: Pick<Theme, "bold" | "fg">, cacheLimit?: number) {
    this.range = new HistoryRange(createHistoryIndex(entries));
    this.renderer = new HistoryEntryRenderer(theme, cacheLimit);
  }

  get admittedWindows(): number {
    return this.range.admittedWindows;
  }

  get cachedBlocks(): number {
    return this.renderer.cachedBlocks;
  }

  get totalWindows(): number {
    return this.range.index.totalWindows;
  }

  invalidate(): void {
    this.renderer.clear();
  }

  render(width: number, height: number): readonly string[] {
    this.resize(width, height);
    const lines: string[] = [];
    let position: HistoryPosition | undefined = this.top;
    while (position && lines.length < this.viewportHeight) {
      const block = this.block(position.entryIndex);
      lines.push(block[position.lineOffset] ?? "");
      position = this.next(position);
    }
    while (lines.length < this.viewportHeight) lines.push("");
    return lines;
  }

  private resize(width: number, height: number): void {
    const wasAtNewest = this.top ? this.viewportEndsAtNewest(this.top) : true;
    const widthChanged = this.width !== Math.max(1, width);
    this.width = Math.max(1, width);
    this.viewportHeight = Math.max(1, height);
    if (!this.top || wasAtNewest) {
      this.top = this.newestTop();
    } else if (widthChanged) {
      const block = this.block(this.top.entryIndex);
      this.top = {
        entryIndex: this.top.entryIndex,
        lineOffset: Math.min(this.top.lineOffset, block.length - 1),
      };
    }
  }

  moveBackward(lines: number): void {
    this.ensurePosition();
    let loadedOlder = false;
    let movementLimit = Math.max(1, lines);
    for (let index = 0; index < movementLimit; index += 1) {
      const previous = this.previous(this.ensurePosition());
      if (previous) {
        this.top = previous;
        continue;
      }
      if (loadedOlder || !this.range.loadOlder()) break;
      loadedOlder = true;
      if (movementLimit > 1) movementLimit -= 1;
      const older = this.previous(this.ensurePosition());
      if (!older) break;
      this.top = older;
    }
  }

  moveForward(lines: number): void {
    this.ensurePosition();
    for (let index = 0; index < Math.max(1, lines); index += 1) {
      const current = this.ensurePosition();
      if (this.viewportEndsAtNewest(current)) break;
      const next = this.next(current);
      if (!next) break;
      this.top = next;
    }
  }

  moveToOldest(): void {
    this.ensurePosition();
    this.top = { entryIndex: this.range.startIndex, lineOffset: 0 };
  }

  moveToNewest(): void {
    this.ensurePosition();
    this.top = this.newestTop();
  }

  toggleCurrentEntry(): void {
    const current = this.ensurePosition();
    const entryIndex = current.entryIndex;
    if (this.detailedEntries.has(entryIndex)) {
      this.detailedEntries.delete(entryIndex);
    } else {
      this.detailedEntries.add(entryIndex);
    }
    this.renderer.clear();
    const block = this.block(entryIndex);
    this.top = {
      entryIndex,
      lineOffset: Math.min(current.lineOffset, block.length - 1),
    };
  }

  private block(entryIndex: number): readonly string[] {
    const entry = this.range.index.entries[entryIndex];
    if (entry === undefined) return [""];
    return this.renderer.render(
      entry,
      entryIndex,
      this.width,
      this.detailedEntries.has(entryIndex),
    );
  }

  private ensurePosition(): HistoryPosition {
    this.top ??= this.newestTop();
    return this.top;
  }

  private newestTop(): HistoryPosition {
    const lastEntryIndex = Math.max(this.range.startIndex, this.range.index.entries.length - 1);
    const lastBlock = this.block(lastEntryIndex);
    let position: HistoryPosition = {
      entryIndex: lastEntryIndex,
      lineOffset: Math.max(0, lastBlock.length - 1),
    };
    for (let index = 1; index < this.viewportHeight; index += 1) {
      const previous = this.previous(position);
      if (!previous) break;
      position = previous;
    }
    return position;
  }

  private next(position: HistoryPosition): HistoryPosition | undefined {
    const block = this.block(position.entryIndex);
    if (position.lineOffset + 1 < block.length) {
      return { entryIndex: position.entryIndex, lineOffset: position.lineOffset + 1 };
    }
    if (position.entryIndex + 1 >= this.range.index.entries.length) return undefined;
    return { entryIndex: position.entryIndex + 1, lineOffset: 0 };
  }

  private previous(position: HistoryPosition): HistoryPosition | undefined {
    if (position.lineOffset > 0) {
      return { entryIndex: position.entryIndex, lineOffset: position.lineOffset - 1 };
    }
    if (position.entryIndex <= this.range.startIndex) return undefined;
    const previousEntryIndex = position.entryIndex - 1;
    return {
      entryIndex: previousEntryIndex,
      lineOffset: Math.max(0, this.block(previousEntryIndex).length - 1),
    };
  }

  private viewportEndsAtNewest(top: HistoryPosition): boolean {
    let position: HistoryPosition | undefined = top;
    for (let index = 1; index < this.viewportHeight; index += 1) {
      const next = this.next(position);
      if (!next) return true;
      position = next;
    }
    return this.next(position) === undefined;
  }
}

export class HistoryExplorer implements Component {
  private closed = false;
  private readonly closeCallback: () => void;
  private readonly theme: Pick<Theme, "bold" | "fg">;
  private readonly tui: ExplorerTui;
  private readonly viewport: HistoryViewport;

  constructor(
    tui: ExplorerTui,
    theme: Pick<Theme, "bold" | "fg">,
    entries: readonly unknown[],
    close: () => void,
  ) {
    this.tui = tui;
    this.theme = theme;
    this.closeCallback = close;
    this.viewport = new HistoryViewport(entries, theme);
  }

  handleInput(data: string): void {
    if (this.isCloseInput(data)) {
      this.close();
      return;
    }
    if (
      this.handleLineInput(data) ||
      this.handleScreenInput(data) ||
      this.handleBoundaryInput(data) ||
      this.handleDetailInput(data)
    ) {
      this.tui.requestRender();
    }
  }

  invalidate(): void {
    this.viewport.invalidate();
  }

  render(width: number): string[] {
    if (width < 4) return ["".padEnd(Math.max(0, width))];
    const safeWidth = width;
    const innerWidth = safeWidth - 2;
    const overlayHeight = this.overlayHeight();
    const contentHeight = this.contentHeight(overlayHeight);
    const body = this.viewport
      .render(innerWidth, Math.max(1, contentHeight))
      .slice(0, contentHeight);
    const border = this.theme.fg("border", `+${"-".repeat(innerWidth)}+`);
    const row = (content: string) =>
      `${this.theme.fg("border", "|")}${padLine(content, innerWidth)}${this.theme.fg("border", "|")}`;
    const title = this.theme.bold(
      this.theme.fg(
        "accent",
        ` Turn Fold history · ${String(this.viewport.admittedWindows)} of ${String(this.viewport.totalWindows)} windows`,
      ),
    );
    const hint = this.theme.fg(
      "dim",
      " ↑/↓ or C-p/C-n line · b/space screen · g/G ends · enter details · q/esc/C-S-o close",
    );
    const lines =
      overlayHeight >= 6
        ? [
            border,
            row(title),
            row(hint),
            row(this.theme.fg("border", "-".repeat(innerWidth))),
            ...body.map(row),
            border,
          ]
        : [border, row(title), ...body.map(row), border];
    return lines.slice(0, overlayHeight);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeCallback();
  }

  private isCloseInput(data: string): boolean {
    return matchesKey(data, "escape") || matchesKey(data, "ctrl+shift+o") || data === "q";
  }

  private handleLineInput(data: string): boolean {
    if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) {
      this.viewport.moveBackward(1);
      return true;
    }
    if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) {
      this.viewport.moveForward(1);
      return true;
    }
    return false;
  }

  private handleScreenInput(data: string): boolean {
    if (data === "b" || matchesKey(data, "pageUp")) {
      this.viewport.moveBackward(Math.max(1, this.contentHeight(this.overlayHeight())));
      return true;
    }
    if (matchesKey(data, "space") || matchesKey(data, "pageDown")) {
      this.viewport.moveForward(Math.max(1, this.contentHeight(this.overlayHeight())));
      return true;
    }
    return false;
  }

  private handleBoundaryInput(data: string): boolean {
    if (data === "G" || matchesKey(data, "shift+g")) {
      this.viewport.moveToNewest();
      return true;
    }
    if (data === "g") {
      this.viewport.moveToOldest();
      return true;
    }
    return false;
  }

  private handleDetailInput(data: string): boolean {
    if (!matchesKey(data, "enter")) return false;
    this.viewport.toggleCurrentEntry();
    return true;
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
