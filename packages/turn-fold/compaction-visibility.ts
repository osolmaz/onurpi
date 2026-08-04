import { entryTimestamp, stringField } from "./turn-message.ts";

export class CompactionVisibility {
  private timestampByComponent = new WeakMap<object, number>();
  private hiddenTimestamps = new Set<number>();
  private historicalTimestamps = new Set<number>();

  recordHistoricalTimestamp(timestamp: number): void {
    this.historicalTimestamps.add(timestamp);
  }

  apply(displayEntries: readonly unknown[]): void {
    const visibleTimestamps = new Set<number>();
    for (const entry of displayEntries) {
      if (stringField(entry, "type") !== "compaction") continue;
      const timestamp = entryTimestamp(entry);
      if (timestamp !== undefined) visibleTimestamps.add(timestamp);
    }
    this.hiddenTimestamps = new Set(
      [...this.historicalTimestamps].filter((timestamp) => !visibleTimestamps.has(timestamp)),
    );
  }

  associate(component: object, timestamp: number | undefined): void {
    if (timestamp !== undefined) this.timestampByComponent.set(component, timestamp);
  }

  visible(component: object): boolean {
    const timestamp = this.timestampByComponent.get(component);
    return timestamp === undefined || !this.hiddenTimestamps.has(timestamp);
  }
}
