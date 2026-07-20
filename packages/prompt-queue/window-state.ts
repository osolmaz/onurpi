import type { PromptHistory } from "./history-model.ts";
import type { PromptQueue, QueueItemMode } from "./queue-model.ts";

export type ManagerTab = "queue" | "history";

export type WindowTarget = { kind: "queue"; id: number } | { kind: "history"; index: number };

export type WindowEntry = {
  target: WindowTarget;
  text: string;
  mode?: QueueItemMode;
};

export type WindowRow =
  | { kind: "empty"; label: string }
  | { kind: "entry"; entry: WindowEntry; selected: boolean };

export type ManagerResult =
  | { kind: "close" }
  | { kind: "edit"; target: WindowTarget; text: string }
  | { kind: "insert"; text: string };

/** Visible slice of a list that keeps the selected index on screen. */
export function viewportSlice(
  total: number,
  selected: number,
  maxVisible: number,
): { start: number; end: number } {
  const half = Math.floor(maxVisible / 2);
  const start = Math.max(0, Math.min(selected - half, total - maxVisible));
  return { start, end: Math.min(total, start + maxVisible) };
}

/**
 * Selection and mutation state for the queue/history manager window. The
 * window shows one tab at a time: the queue tab when anything is pending,
 * otherwise the history tab. Mutations are applied directly to the shared
 * models so the widget and delivery logic always observe the same data.
 */
export class ManagerWindowState {
  private cursor = 0;
  private tab: ManagerTab;

  constructor(
    private readonly queue: PromptQueue,
    private readonly history: PromptHistory,
  ) {
    this.tab = queue.size > 0 ? "queue" : "history";
  }

  activeTab(): ManagerTab {
    return this.tab;
  }

  queueCount(): number {
    return this.queue.size;
  }

  historyCount(): number {
    return this.history.size;
  }

  setTab(tab: ManagerTab): boolean {
    if (tab === this.tab) return false;
    this.tab = tab;
    this.cursor = 0;
    return true;
  }

  toggleTab(): boolean {
    return this.setTab(this.tab === "queue" ? "history" : "queue");
  }

  entries(): WindowEntry[] {
    if (this.tab === "queue") {
      return this.queue.items().map(
        (item): WindowEntry => ({
          target: { kind: "queue", id: item.id },
          text: item.text,
          mode: item.mode,
        }),
      );
    }
    return this.history.entries().map(
      (text, index): WindowEntry => ({
        target: { kind: "history", index },
        text,
      }),
    );
  }

  rows(): WindowRow[] {
    const entries = this.entries();
    this.clampCursor(entries.length);
    if (entries.length === 0) {
      const label = this.tab === "queue" ? "nothing queued" : "no prompts yet";
      return [{ kind: "empty", label }];
    }
    return entries.map((entry, index) => ({
      kind: "entry",
      entry,
      selected: index === this.cursor,
    }));
  }

  moveCursor(delta: number): boolean {
    const count = this.entries().length;
    if (count === 0) return false;
    this.clampCursor(count);
    const next = Math.min(Math.max(this.cursor + delta, 0), count - 1);
    if (next === this.cursor) return false;
    this.cursor = next;
    return true;
  }

  selection(): WindowEntry | undefined {
    const entries = this.entries();
    this.clampCursor(entries.length);
    return entries[this.cursor];
  }

  deleteSelected(): boolean {
    const entry = this.selection();
    if (!entry) return false;
    if (entry.target.kind === "history") return this.history.removeAt(entry.target.index);
    this.queue.remove(entry.target.id);
    if (this.queue.size === 0) this.setTab("history");
    return true;
  }

  toggleSelectedMode(): boolean {
    const entry = this.selection();
    if (entry?.target.kind !== "queue") return false;
    return this.queue.toggleMode(entry.target.id);
  }

  moveSelected(direction: -1 | 1): boolean {
    const entry = this.selection();
    if (entry?.target.kind !== "queue") return false;
    if (!this.queue.move(entry.target.id, direction)) return false;
    this.cursor += direction;
    return true;
  }

  /** Text of the selection; queue items are removed since they move to the editor. */
  takeForInsert(): string | undefined {
    const entry = this.selection();
    if (!entry) return undefined;
    if (entry.target.kind === "queue") this.queue.remove(entry.target.id);
    return entry.text;
  }

  private clampCursor(count: number): void {
    this.cursor = Math.max(0, Math.min(this.cursor, count - 1));
  }
}
