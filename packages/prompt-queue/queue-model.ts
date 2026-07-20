export type QueueItemMode = "steer" | "queue";

export type QueueItem = {
  readonly id: number;
  readonly mode: QueueItemMode;
  readonly text: string;
};

/**
 * Ordered list of prompts waiting for delivery. Items keep insertion order;
 * "steer" items are additionally eligible for mid-run delivery at turn
 * boundaries while "queue" items wait until the agent settles.
 */
export class PromptQueue {
  private list: QueueItem[] = [];
  private nextId = 1;

  get size(): number {
    return this.list.length;
  }

  items(): readonly QueueItem[] {
    return this.list;
  }

  add(text: string, mode: QueueItemMode): QueueItem {
    const item: QueueItem = { id: this.nextId, mode, text };
    this.nextId += 1;
    this.list.push(item);
    return item;
  }

  update(id: number, text: string): boolean {
    const index = this.indexOf(id);
    const current = this.list[index];
    if (!current) return false;
    this.list[index] = { ...current, text };
    return true;
  }

  toggleMode(id: number): boolean {
    const index = this.indexOf(id);
    const current = this.list[index];
    if (!current) return false;
    this.list[index] = { ...current, mode: current.mode === "steer" ? "queue" : "steer" };
    return true;
  }

  remove(id: number): boolean {
    const index = this.indexOf(id);
    if (index === -1) return false;
    this.list.splice(index, 1);
    return true;
  }

  move(id: number, direction: -1 | 1): boolean {
    const index = this.indexOf(id);
    const target = index + direction;
    const item = this.list[index];
    const other = this.list[target];
    if (!item || !other) return false;
    this.list[index] = other;
    this.list[target] = item;
    return true;
  }

  hasSteer(): boolean {
    return this.list.some((item) => item.mode === "steer");
  }

  takeFirst(): QueueItem | undefined {
    return this.list.shift();
  }

  takeFirstSteer(): QueueItem | undefined {
    const index = this.list.findIndex((item) => item.mode === "steer");
    if (index === -1) return undefined;
    const [item] = this.list.splice(index, 1);
    return item;
  }

  private indexOf(id: number): number {
    return this.list.findIndex((item) => item.id === id);
  }
}
