import {
  historyEntryPresentation,
  historyKindMatchesFilter,
  type HistoryEntryPresentation,
  type HistoryFilter,
  type HistorySectionKind,
} from "./history-entry.ts";

const DEFAULT_ENTRY_BUDGET = 50;
const DEFAULT_CHARACTER_BUDGET = 64_000;
const SNIPPET_RADIUS = 80;

export type HistorySearchMatch = Readonly<{
  entryIndex: number;
  section: HistorySectionKind | undefined;
  snippet: string;
}>;

export type HistorySearchProgress = Readonly<{
  complete: boolean;
  matchedEntries: number;
  scannedEntries: number;
  totalEntries: number;
}>;

type ActiveEntry = {
  entryIndex: number;
  normalized: string;
  offset: number;
  original: string;
  section: HistorySectionKind | undefined;
};

function normalized(value: string): string {
  return value.toLocaleLowerCase();
}

function searchSection(
  presented: HistoryEntryPresentation,
  query: string,
): HistorySectionKind | undefined {
  return presented.sections.find((section) => normalized(section.text).includes(query))?.kind;
}

function matchSnippet(text: string, index: number, queryLength: number): string {
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(text.length, index + queryLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).replaceAll(/\s+/gu, " ").trim()}${suffix}`;
}

export class HistorySearch {
  private active: ActiveEntry | undefined;
  private completeValue = true;
  private readonly entries: readonly unknown[];
  private filterValue: HistoryFilter = "all";
  private nextEntryIndex = 0;
  private queryNormalized = "";
  private queryValue = "";
  private readonly resultsValue: HistorySearchMatch[] = [];
  private scannedEntriesValue = 0;

  constructor(entries: readonly unknown[]) {
    this.entries = entries;
  }

  get complete(): boolean {
    return this.completeValue;
  }

  get filter(): HistoryFilter {
    return this.filterValue;
  }

  get progress(): HistorySearchProgress {
    return {
      complete: this.completeValue,
      matchedEntries: this.resultsValue.length,
      scannedEntries: this.scannedEntriesValue,
      totalEntries: this.entries.length,
    };
  }

  get query(): string {
    return this.queryValue;
  }

  get results(): readonly HistorySearchMatch[] {
    return this.resultsValue;
  }

  clear(): void {
    this.start("", this.filterValue);
  }

  start(query: string, filter: HistoryFilter): void {
    this.active = undefined;
    this.filterValue = filter;
    this.nextEntryIndex = 0;
    this.queryValue = query.trim();
    this.queryNormalized = normalized(this.queryValue);
    this.resultsValue.length = 0;
    this.scannedEntriesValue = 0;
    this.completeValue = this.queryNormalized.length === 0 || this.entries.length === 0;
  }

  step(
    entryBudget = DEFAULT_ENTRY_BUDGET,
    characterBudget = DEFAULT_CHARACTER_BUDGET,
  ): HistorySearchProgress {
    let entriesLeft = Math.max(1, Math.floor(entryBudget));
    let charactersLeft = Math.max(1, Math.floor(characterBudget));
    while (!this.completeValue && entriesLeft > 0 && charactersLeft > 0) {
      const progress = this.scanStep(charactersLeft);
      charactersLeft -= progress.consumed;
      if (progress.finishedEntry) entriesLeft -= 1;
    }
    return this.progress;
  }

  next(currentEntryIndex: number | undefined, direction: 1 | -1): HistorySearchMatch | undefined {
    if (this.resultsValue.length === 0) return undefined;
    if (currentEntryIndex === undefined) {
      return direction > 0 ? this.resultsValue[0] : this.resultsValue.at(-1);
    }
    const exact = this.resultsValue.findIndex((result) => result.entryIndex === currentEntryIndex);
    if (exact >= 0) {
      const nextIndex = (exact + direction + this.resultsValue.length) % this.resultsValue.length;
      return this.resultsValue[nextIndex];
    }
    if (direction > 0) {
      return (
        this.resultsValue.find((result) => result.entryIndex > currentEntryIndex) ??
        this.resultsValue[0]
      );
    }
    return this.previousResult(currentEntryIndex) ?? this.resultsValue.at(-1);
  }

  ordinal(entryIndex: number): number | undefined {
    const index = this.resultsValue.findIndex((result) => result.entryIndex === entryIndex);
    return index < 0 ? undefined : index + 1;
  }

  private scanStep(characterBudget: number): { consumed: number; finishedEntry: boolean } {
    this.active ??= this.openNextEntry();
    if (!this.active) {
      this.completeValue = true;
      return { consumed: 1, finishedEntry: false };
    }
    return this.scanActive(characterBudget);
  }

  private previousResult(entryIndex: number): HistorySearchMatch | undefined {
    for (let index = this.resultsValue.length - 1; index >= 0; index -= 1) {
      const result = this.resultsValue[index];
      if (result && result.entryIndex < entryIndex) return result;
    }
    return undefined;
  }

  private openNextEntry(): ActiveEntry | undefined {
    while (this.nextEntryIndex < this.entries.length) {
      const entryIndex = this.nextEntryIndex;
      this.nextEntryIndex += 1;
      const entry = this.entries[entryIndex];
      const presented = historyEntryPresentation(entry);
      if (!historyKindMatchesFilter(presented.kind, this.filterValue)) {
        this.scannedEntriesValue += 1;
        continue;
      }
      const original = `${presented.label}\n${presented.searchableText}`;
      return {
        entryIndex,
        normalized: normalized(original),
        offset: 0,
        original,
        section: searchSection(presented, this.queryNormalized),
      };
    }
    return undefined;
  }

  private scanActive(characterBudget: number): { consumed: number; finishedEntry: boolean } {
    const active = this.active;
    if (!active) return { consumed: 1, finishedEntry: false };
    const overlap = Math.max(0, this.queryNormalized.length - 1);
    const end = Math.min(active.normalized.length, active.offset + characterBudget);
    const searchEnd = Math.min(active.normalized.length, end + overlap);
    const found = active.normalized.indexOf(this.queryNormalized, active.offset);
    if (found >= 0 && found < searchEnd) {
      this.resultsValue.push({
        entryIndex: active.entryIndex,
        section: active.section,
        snippet: matchSnippet(active.original, found, this.queryNormalized.length),
      });
      this.finishActive();
      return { consumed: Math.max(1, end - active.offset), finishedEntry: true };
    }
    const consumed = Math.max(1, end - active.offset);
    active.offset = end;
    const finishedEntry = active.offset >= active.normalized.length;
    if (finishedEntry) this.finishActive();
    return { consumed, finishedEntry };
  }

  private finishActive(): void {
    this.active = undefined;
    this.scannedEntriesValue += 1;
    if (this.nextEntryIndex >= this.entries.length) this.completeValue = true;
  }
}
