import { entryTimestamp, stringField } from "./turn-message.ts";

export class CompactionVisibility {
  private entryIdByComponent = new WeakMap<object, string>();
  private entryIdsByTimestamp = new Map<number, string[]>();
  private nextIndexByTimestamp = new Map<number, number>();
  private visibleEntryIds = new Set<string>();

  recordHistoricalEntry(entry: unknown): void {
    const entryId = stringField(entry, "id");
    const timestamp = entryTimestamp(entry);
    if (!entryId || timestamp === undefined) return;
    const entryIds = this.entryIdsByTimestamp.get(timestamp) ?? [];
    entryIds.push(entryId);
    this.entryIdsByTimestamp.set(timestamp, entryIds);
    this.visibleEntryIds.add(entryId);
  }

  apply(displayEntries: readonly unknown[]): void {
    this.visibleEntryIds = new Set(
      displayEntries
        .filter((entry) => stringField(entry, "type") === "compaction")
        .map((entry) => stringField(entry, "id"))
        .filter((entryId): entryId is string => entryId !== undefined),
    );
  }

  associate(component: object, timestamp: number | undefined): void {
    if (timestamp === undefined || this.entryIdByComponent.has(component)) return;
    const entryIds = this.entryIdsByTimestamp.get(timestamp);
    const index = this.nextIndexByTimestamp.get(timestamp) ?? 0;
    const entryId = entryIds?.[index];
    if (!entryId) return;
    this.entryIdByComponent.set(component, entryId);
    this.nextIndexByTimestamp.set(timestamp, index + 1);
  }

  visible(component: object): boolean {
    const entryId = this.entryIdByComponent.get(component);
    return entryId === undefined || this.visibleEntryIds.has(entryId);
  }
}
