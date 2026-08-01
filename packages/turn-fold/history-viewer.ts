import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, type Component } from "@earendil-works/pi-tui";

import { isRecord, messageFromEntry, stringField } from "./turn-message.ts";

const ENTRIES_PER_PAGE = 20;
const ENTRY_CHARACTER_LIMIT = 2_000;

function terminalSafe(value: string): string {
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

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const type = stringField(item, "type");
      if (type === "text") return stringField(item, "text") ?? "";
      if (type === "thinking") return stringField(item, "thinking") ?? "";
      if (type === "toolCall") {
        return `[tool ${stringField(item, "name") ?? "unknown"} ${stringField(item, "id") ?? ""}]`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function entryLabel(entry: unknown): string {
  const type = stringField(entry, "type") ?? "entry";
  const message = messageFromEntry(entry);
  const role = stringField(message, "role");
  if (role) return role;
  if (type === "compaction") return "compaction";
  if (type === "custom_message") return stringField(entry, "customType") ?? "custom message";
  return stringField(entry, "customType") ?? type;
}

function entryBody(entry: unknown): string {
  const message = messageFromEntry(entry);
  if (isRecord(message)) return contentText(message["content"]);
  if (!isRecord(entry)) return "";
  if (entry["type"] === "compaction") return stringField(entry, "summary") ?? "";
  if (entry["type"] === "custom_message") return stringField(entry, "content") ?? "";
  return "";
}

export function historyEntryText(entry: unknown): string {
  const id = stringField(entry, "id") ?? "unknown";
  const fullBody = terminalSafe(entryBody(entry));
  const body = fullBody.slice(0, ENTRY_CHARACTER_LIMIT);
  const suffix = fullBody.length > ENTRY_CHARACTER_LIMIT ? "\n…" : "";
  return `${entryLabel(entry)} ${id}${body ? `\n${body}${suffix}` : ""}`;
}

export function historyPages(entries: readonly unknown[]): readonly (readonly string[])[] {
  const rows = entries.map((entry) => historyEntryText(entry));
  if (rows.length === 0) return [["No transcript entries in the selected range."]];
  const pages: string[][] = [];
  for (let index = 0; index < rows.length; index += ENTRIES_PER_PAGE) {
    pages.push(rows.slice(index, index + ENTRIES_PER_PAGE));
  }
  return pages;
}

function isNextPageKey(data: string): boolean {
  return matchesKey(data, "right") || matchesKey(data, "pageDown") || data === "l";
}

function isPreviousPageKey(data: string): boolean {
  return matchesKey(data, "left") || matchesKey(data, "pageUp") || data === "h";
}

export class HistoryViewer implements Component {
  private page = 0;
  private readonly pages: readonly (readonly string[])[];
  private readonly requestRender: () => void;
  private readonly close: () => void;
  private readonly text: Text;
  private readonly styleHint: (text: string) => string;
  private readonly styleTitle: (text: string) => string;

  constructor(
    pages: readonly (readonly string[])[],
    styleTitle: (text: string) => string,
    styleHint: (text: string) => string,
    requestRender: () => void,
    close: () => void,
  ) {
    this.pages = pages;
    this.styleTitle = styleTitle;
    this.styleHint = styleHint;
    this.requestRender = requestRender;
    this.close = close;
    this.text = new Text("", 1, 1);
    this.updateText();
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.close();
      return;
    }
    if (isNextPageKey(data)) {
      this.setPage(Math.min(this.pages.length - 1, this.page + 1));
      return;
    }
    if (isPreviousPageKey(data)) {
      this.setPage(Math.max(0, this.page - 1));
    }
  }

  invalidate(): void {
    this.text.invalidate();
  }

  render(width: number): string[] {
    return this.text.render(width);
  }

  private setPage(page: number): void {
    if (page === this.page) return;
    this.page = page;
    this.updateText();
    this.requestRender();
  }

  private updateText(): void {
    const title = this.styleTitle(
      `Turn Fold history ${String(this.page + 1)}/${String(this.pages.length)}`,
    );
    const hint = this.styleHint("←/→ or h/l page · q/esc close");
    this.text.setText(`${title}\n${hint}\n\n${(this.pages[this.page] ?? []).join("\n\n")}`);
  }
}

export async function showHistoryViewer(
  ctx: ExtensionCommandContext,
  entries: readonly unknown[],
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify("Turn Fold history is available only in TUI mode.", "warning");
    return;
  }
  const pages = historyPages(entries);
  await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
    return new HistoryViewer(
      pages,
      (text) => theme.bold(theme.fg("accent", text)),
      (text) => theme.fg("dim", text),
      () => {
        tui.requestRender();
      },
      () => {
        done(undefined);
      },
    );
  });
}
