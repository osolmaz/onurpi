import type { Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TUI } from "@earendil-works/pi-tui";

import { previewText } from "./widget-lines.ts";
import {
  type ManagerResult,
  type ManagerWindowState,
  viewportSlice,
  type WindowRow,
} from "./window-state.ts";

const MAX_VISIBLE_ROWS = 14;
const HINT =
  "↑↓ move · ⇥ switch tab · enter to editor · e edit · m mode · s send now · d delete · p/n reorder · r resume · esc close";

/**
 * Full-width tabbed list view shown in place of the prompt editor. Queue
 * delivery is paused by the extension while this window is open.
 */
export class ManagerWindow {
  constructor(
    private readonly state: ManagerWindowState,
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (result: ManagerResult) => void,
  ) {}

  handleInput(data: string): void {
    this.handleKey(data);
    this.tui.requestRender();
  }

  private handleKey(data: string): void {
    if (this.handleSpecialKey(data) || this.handleFinishKey(data)) return;
    if (data === "m") this.state.toggleSelectedMode();
    else if (data === "d") this.state.deleteSelected();
    else if (data === "p") this.state.moveSelected(-1);
    else if (data === "n") this.state.moveSelected(1);
  }

  private handleFinishKey(data: string): boolean {
    if (data === "e") this.finishEdit();
    else if (data === "s") this.finishSendNow();
    else if (data === "r") this.done({ kind: "resume" });
    else return false;
    return true;
  }

  private handleSpecialKey(data: string): boolean {
    if (matchesKey(data, Key.up)) this.state.moveCursor(-1);
    else if (matchesKey(data, Key.down)) this.state.moveCursor(1);
    else if (matchesKey(data, Key.tab) || matchesKey(data, Key.left) || matchesKey(data, Key.right))
      this.state.toggleTab();
    else if (matchesKey(data, Key.escape)) this.done({ kind: "close" });
    else if (matchesKey(data, Key.enter)) this.finishInsert();
    else return false;
    return true;
  }

  private finishInsert(): void {
    const text = this.state.takeSelected();
    if (text !== undefined) this.done({ kind: "insert", text });
  }

  private finishSendNow(): void {
    const text = this.state.takeSelected();
    if (text !== undefined) this.done({ kind: "send-now", text });
  }

  private finishEdit(): void {
    const entry = this.state.selection();
    if (entry) this.done({ kind: "edit", target: entry.target, text: entry.text });
  }

  render(width: number): string[] {
    const theme = this.theme;
    const border = theme.fg("border", "─".repeat(Math.max(width, 1)));
    const lines = [border, truncateToWidth(this.tabBar(), width), ...this.rowLines(width)];
    lines.push(truncateToWidth(theme.fg("dim", ` ${HINT}`), width), border);
    return lines;
  }

  private tabBar(): string {
    const theme = this.theme;
    const active = this.state.activeTab();
    const label = (tab: "queue" | "history", text: string): string =>
      tab === active
        ? theme.fg("accent", theme.bold(`[ ${text} ]`))
        : theme.fg("dim", `  ${text}  `);
    return (
      " " +
      label("history", `History (${String(this.state.historyCount())})`) +
      " " +
      label("queue", `Queue (${String(this.state.queueCount())})`) +
      theme.fg("dim", " — delivery paused while open")
    );
  }

  private rowLines(width: number): string[] {
    const rows = this.state.rows();
    const selectedIndex = rows.findIndex((row) => row.kind === "entry" && row.selected);
    const { start, end } = viewportSlice(rows.length, Math.max(selectedIndex, 0), MAX_VISIBLE_ROWS);
    const lines = rows.slice(start, end).map((row) => this.rowLine(row, width));
    if (start > 0) lines.unshift(this.theme.fg("dim", ` ↑ ${String(start)} more`));
    if (end < rows.length) lines.push(this.theme.fg("dim", ` ↓ ${String(rows.length - end)} more`));
    return lines;
  }

  private rowLine(row: WindowRow, width: number): string {
    const theme = this.theme;
    if (row.kind === "empty") return truncateToWidth(theme.fg("dim", `   (${row.label})`), width);
    const pointer = row.selected ? theme.fg("accent", " ▸ ") : "   ";
    const mode =
      row.entry.mode === undefined
        ? ""
        : row.entry.mode === "steer"
          ? theme.fg("warning", "[steer] ")
          : theme.fg("accent", "[queued] ");
    const text = row.selected
      ? theme.fg("accent", previewText(row.entry.text))
      : previewText(row.entry.text);
    return truncateToWidth(pointer + mode + text, width);
  }

  invalidate(): void {
    // Rendering reads state on demand; there is no cache to drop.
  }
}
