import {
  historyEntryKind,
  historyEntryMatchesFilter,
  historyEntryPresentation,
  historyToolCallInfos,
  type HistoryEntryPresentation,
  type HistoryFilter,
  type HistorySectionKind,
} from "./history-entry.ts";
import { createHistoryIndex, HistoryRange, type HistoryIndex } from "./history-index.ts";
import { BoundedNavigationHistory } from "./history-navigation.ts";
import {
  DEFAULT_HISTORY_ENTRY_DISPLAY,
  HistoryEntryRenderer,
  type HistoryEntryDisplayState,
  type HistoryRenderTheme,
} from "./history-renderer.ts";
import type { HistorySearchMatch } from "./history-search.ts";

export type HistoryPosition = Readonly<{
  entryIndex: number;
  lineOffset: number;
  pageIndex: number;
  segmentIndex: number;
}>;

type HistoryLocation = Readonly<{
  filter: HistoryFilter;
  focusEntryIndex: number | undefined;
  position: HistoryPosition;
}>;

export type HistoryViewportContext = Readonly<{
  entryIndex: number;
  filter: HistoryFilter;
  presentation: HistoryEntryPresentation;
  totalEntries: number;
  totalWindows: number;
  windowNumber: number;
}>;

type EntryDisplayOverride = {
  -readonly [Key in keyof HistoryEntryDisplayState]?: HistoryEntryDisplayState[Key];
};
type SectionKey = "showDiffs" | "showThinking" | "showToolOutput";

function clearSection(override: EntryDisplayOverride, key: SectionKey): EntryDisplayOverride {
  const next: EntryDisplayOverride = {};
  if (override.detailed !== undefined) next.detailed = override.detailed;
  if (key !== "showDiffs" && override.showDiffs !== undefined) next.showDiffs = override.showDiffs;
  if (key !== "showThinking" && override.showThinking !== undefined) {
    next.showThinking = override.showThinking;
  }
  if (key !== "showToolOutput" && override.showToolOutput !== undefined) {
    next.showToolOutput = override.showToolOutput;
  }
  return next;
}

export class HistoryViewport {
  private readonly callSummaries = new Map<string, string>();
  private readonly inspectedCallEntries = new Set<number>();
  private readonly entryOverrides = new Map<number, EntryDisplayOverride>();
  private sessionDisplay: HistoryEntryDisplayState = DEFAULT_HISTORY_ENTRY_DISPLAY;
  private readonly presentations = new Map<number, HistoryEntryPresentation>();
  private filterValue: HistoryFilter = "all";
  private focusEntryIndex: number | undefined;
  private readonly history = new BoundedNavigationHistory<HistoryLocation>();
  readonly index: HistoryIndex;
  private queryValue = "";
  private readonly range: HistoryRange;
  private readonly renderer: HistoryEntryRenderer;
  private readonly theme: HistoryRenderTheme;
  private top: HistoryPosition | undefined;
  private viewportHeight = 1;
  private width = 1;

  constructor(entries: readonly unknown[], theme: HistoryRenderTheme, cacheLimit?: number) {
    this.index = createHistoryIndex(entries);
    this.range = new HistoryRange(this.index);
    this.renderer = new HistoryEntryRenderer(theme, cacheLimit);
    this.theme = theme;
  }

  get admittedWindows(): number {
    return this.index.entries.length === 0 ? 0 : this.range.admittedWindows;
  }

  get cachedBlocks(): number {
    return this.renderer.cachedBlocks;
  }

  get currentEntryIndex(): number | undefined {
    if (this.index.entries.length === 0) return undefined;
    return this.focusEntryIndex ?? this.top?.entryIndex;
  }

  get entries(): readonly unknown[] {
    return this.index.entries;
  }

  get filter(): HistoryFilter {
    return this.filterValue;
  }

  get navigationCounts(): Readonly<{ back: number; forward: number }> {
    return { back: this.history.backwardCount, forward: this.history.forwardCount };
  }

  get query(): string {
    return this.queryValue;
  }

  get totalWindows(): number {
    return this.index.entries.length === 0 ? 0 : this.index.totalWindows;
  }

  context(): HistoryViewportContext | undefined {
    const entryIndex = this.currentEntryIndex;
    if (entryIndex === undefined) return undefined;
    const entry = this.index.entries[entryIndex];
    if (entry === undefined) return undefined;
    const presentation = this.present(entryIndex);
    if (presentation === undefined) return undefined;
    return {
      entryIndex,
      filter: this.filterValue,
      presentation,
      totalEntries: this.index.entries.length,
      totalWindows: this.index.totalWindows,
      windowNumber: this.index.entryWindows[entryIndex] ?? 1,
    };
  }

  invalidate(): void {
    this.renderer.clear();
  }

  render(width: number, height: number): readonly string[] {
    this.resize(width, height);
    if (this.index.entries.length === 0) return this.emptyRows("[no transcript history]");
    if (!this.hasVisibleEntries())
      return this.emptyRows(`[no entries match filter: ${this.filterValue}]`);
    const lines: string[] = [];
    let position: HistoryPosition | undefined = this.top;
    while (position && lines.length < this.viewportHeight) {
      const block = this.block(position);
      lines.push(block[position.lineOffset] ?? "");
      position = this.next(position);
    }
    while (lines.length < this.viewportHeight) lines.push("");
    return lines;
  }

  moveBackward(lines: number): void {
    this.ensurePosition();
    this.focusEntryIndex = undefined;
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
    this.focusEntryIndex = undefined;
    for (let index = 0; index < Math.max(1, lines); index += 1) {
      const current = this.ensurePosition();
      if (this.viewportEndsAtNewest(current)) break;
      const next = this.next(current);
      if (!next) break;
      this.top = next;
    }
  }

  moveToOldest(record = false): void {
    if (record) this.recordLocation();
    this.focusEntryIndex = undefined;
    const entryIndex = this.firstVisibleEntry(this.range.startIndex, 1);
    if (entryIndex !== undefined) this.top = this.entryStart(entryIndex);
  }

  moveToNewest(record = false): void {
    if (record) this.recordLocation();
    this.focusEntryIndex = undefined;
    this.top = this.newestTop();
  }

  setFilter(filter: HistoryFilter): boolean {
    if (filter === this.filterValue) return false;
    this.recordLocation();
    this.filterValue = filter;
    this.renderer.clear();
    this.admitUntilFilterVisible();
    const current = this.currentEntryIndex;
    this.focusEntryIndex = undefined;
    if (current !== undefined && this.entryVisible(current)) {
      this.top = this.entryStart(current);
      return true;
    }
    const nearest = current === undefined ? undefined : this.nearestVisibleEntry(current);
    this.top = nearest === undefined ? this.newestTop() : this.entryStart(nearest);
    return true;
  }

  hopEntry(direction: -1 | 1): { filterReset: boolean; moved: boolean } {
    const current = this.currentEntryIndex ?? this.range.startIndex;
    let target =
      direction < 0
        ? this.firstVisibleEntry(current - 1, -1)
        : this.firstVisibleEntry(current + 1, 1);
    while (target === undefined && direction < 0 && this.range.loadOlder()) {
      target = this.firstVisibleEntry(current - 1, -1);
    }
    if (target === undefined) return { filterReset: false, moved: false };
    return this.jumpToEntry(target);
  }

  hopUserMessage(direction: -1 | 1): { filterReset: boolean; moved: boolean } {
    const current = this.currentEntryIndex ?? this.range.startIndex;
    for (
      let entryIndex = current + direction;
      entryIndex >= 0 && entryIndex < this.index.entries.length;
      entryIndex += direction
    ) {
      if (historyEntryKind(this.index.entries[entryIndex]) === "user") {
        return this.jumpToEntry(entryIndex);
      }
    }
    return { filterReset: false, moved: false };
  }

  setSearch(query: string): void {
    this.queryValue = query;
    this.focusEntryIndex = undefined;
    this.renderer.clear();
  }

  clearSearch(): void {
    this.setSearch("");
  }

  jumpToEntry(entryIndex: number, contextLines = 8): { filterReset: boolean; moved: boolean } {
    const entry = this.index.entries[entryIndex];
    if (entry === undefined) return { filterReset: false, moved: false };
    this.recordLocation();
    let filterReset = false;
    if (!this.entryVisible(entryIndex)) {
      this.filterValue = "all";
      filterReset = true;
    }
    this.range.admitEntry(entryIndex);
    this.focusEntryIndex = entryIndex;
    const budget = Math.min(Math.max(1, contextLines), Math.max(1, this.viewportHeight - 2));
    let position = this.entryStart(entryIndex);
    for (let count = 0; count < budget; count += 1) {
      const previous = this.previous(position);
      if (!previous) break;
      position = previous;
    }
    this.top = position;
    return { filterReset, moved: true };
  }

  jumpToMatch(match: HistorySearchMatch): { filterReset: boolean; moved: boolean } {
    const jump = this.jumpToEntry(match.entryIndex);
    if (!jump.moved) return jump;
    this.revealSection(match.entryIndex, match.section);
    const entry = this.index.entries[match.entryIndex];
    if (entry === undefined) return { filterReset: jump.filterReset, moved: false };
    const state = this.entryState(match.entryIndex);
    const location = this.renderer.locate(
      entry,
      this.width,
      state,
      this.viewportHeight + 4,
      this.queryValue,
    );
    if (location.pageIndex > 0 || location.segmentIndex > 0) {
      this.top = {
        entryIndex: match.entryIndex,
        lineOffset: 0,
        pageIndex: location.pageIndex,
        segmentIndex: location.segmentIndex,
      };
    }
    return jump;
  }

  goBack(): boolean {
    const current = this.location();
    if (!current) return false;
    const target = this.history.back(current);
    if (!target) return false;
    this.restoreLocation(target);
    return true;
  }

  goForward(): boolean {
    const current = this.location();
    if (!current) return false;
    const target = this.history.next(current);
    if (!target) return false;
    this.restoreLocation(target);
    return true;
  }

  toggleDetails(): boolean {
    const entryIndex = this.currentEntryIndex;
    if (entryIndex === undefined) return false;
    return this.updateCurrentState({ detailed: !this.entryState(entryIndex).detailed });
  }

  toggleThinking(): boolean {
    return this.toggleSection("showThinking", "hasThinking");
  }

  toggleToolOutput(): boolean {
    return this.toggleSection("showToolOutput", "hasToolOutput");
  }

  toggleDiffs(): boolean {
    return this.toggleSection("showDiffs", "hasDiff");
  }

  toggleAllThinking(): boolean {
    return this.toggleAllSection("showThinking");
  }

  toggleAllToolOutput(): boolean {
    return this.toggleAllSection("showToolOutput");
  }

  toggleAllDiffs(): boolean {
    return this.toggleAllSection("showDiffs");
  }

  private toggleSection(
    key: "showDiffs" | "showThinking" | "showToolOutput",
    capability: "hasDiff" | "hasThinking" | "hasToolOutput",
  ): boolean {
    const entryIndex = this.currentEntryIndex;
    if (entryIndex === undefined) return false;
    const entry = this.index.entries[entryIndex];
    if (entry === undefined || !historyEntryPresentation(entry)[capability]) return false;
    return this.updateCurrentState({ [key]: !this.entryState(entryIndex)[key] });
  }

  private toggleAllSection(key: SectionKey): boolean {
    this.sessionDisplay = { ...this.sessionDisplay, [key]: !this.sessionDisplay[key] };
    for (const [entryIndex, override] of this.entryOverrides) {
      const next = clearSection(override, key);
      if (Object.keys(next).length === 0) this.entryOverrides.delete(entryIndex);
      else this.entryOverrides.set(entryIndex, next);
    }
    this.renderer.clear();
    this.clampTop();
    return true;
  }

  private clampTop(): void {
    const current = this.top;
    if (current === undefined) return;
    const pageIndex = Math.min(current.pageIndex, this.pageCount(current.entryIndex) - 1);
    const segmentIndex = Math.min(
      current.segmentIndex,
      this.segmentCount(current.entryIndex, pageIndex) - 1,
    );
    const position = { ...current, pageIndex, segmentIndex };
    this.top = {
      ...position,
      lineOffset: Math.min(current.lineOffset, this.block(position).length - 1),
    };
  }

  private entryState(entryIndex: number): HistoryEntryDisplayState {
    return { ...this.sessionDisplay, ...this.entryOverrides.get(entryIndex) };
  }

  private block(position: HistoryPosition): readonly string[] {
    const entry = this.index.entries[position.entryIndex];
    if (entry === undefined) return [""];
    this.registerToolCalls(position.entryIndex, entry);
    return this.renderer.render(
      entry,
      position.entryIndex,
      this.width,
      this.entryState(position.entryIndex),
      position.segmentIndex,
      this.viewportHeight + 4,
      position.pageIndex,
      this.queryValue,
      position.entryIndex === this.focusEntryIndex,
      this.callSummary(position.entryIndex),
    );
  }

  private registerToolCalls(entryIndex: number, entry: unknown): void {
    if (this.inspectedCallEntries.has(entryIndex)) return;
    this.inspectedCallEntries.add(entryIndex);
    const presentation = this.present(entryIndex);
    if (presentation?.hasToolOutput !== true || presentation.toolCallId !== undefined) return;
    for (const info of historyToolCallInfos(entry)) {
      this.callSummaries.set(info.id, info.summary);
    }
  }

  private callSummary(entryIndex: number): string | undefined {
    const toolCallId = this.present(entryIndex)?.toolCallId;
    if (toolCallId === undefined) return undefined;
    return this.callSummaries.get(toolCallId);
  }

  private present(entryIndex: number): HistoryEntryPresentation | undefined {
    let presentation = this.presentations.get(entryIndex);
    if (presentation === undefined) {
      const entry = this.index.entries[entryIndex];
      if (entry === undefined) return undefined;
      presentation = historyEntryPresentation(entry);
      this.presentations.set(entryIndex, presentation);
    }
    return presentation;
  }

  private pageCount(entryIndex: number): number {
    const entry = this.index.entries[entryIndex];
    return entry === undefined ? 1 : this.renderer.pageCount(entry, this.entryState(entryIndex));
  }

  private segmentCount(entryIndex: number, pageIndex: number): number {
    const entry = this.index.entries[entryIndex];
    if (entry === undefined) return 1;
    return this.renderer.segmentCount(
      entry,
      entryIndex,
      this.width,
      this.entryState(entryIndex),
      this.viewportHeight + 4,
      pageIndex,
    );
  }

  private hasNextPage(entryIndex: number, pageIndex: number): boolean {
    const entry = this.index.entries[entryIndex];
    if (entry === undefined) return false;
    return this.renderer.hasNextPage(
      entry,
      entryIndex,
      this.width,
      this.entryState(entryIndex),
      this.viewportHeight + 4,
      pageIndex,
    );
  }

  private next(position: HistoryPosition): HistoryPosition | undefined {
    const block = this.block(position);
    if (position.lineOffset + 1 < block.length)
      return { ...position, lineOffset: position.lineOffset + 1 };
    if (position.segmentIndex + 1 < this.segmentCount(position.entryIndex, position.pageIndex)) {
      return { ...position, lineOffset: 0, segmentIndex: position.segmentIndex + 1 };
    }
    if (this.hasNextPage(position.entryIndex, position.pageIndex)) {
      return { ...position, lineOffset: 0, pageIndex: position.pageIndex + 1, segmentIndex: 0 };
    }
    const entryIndex = this.firstVisibleEntry(position.entryIndex + 1, 1);
    return entryIndex === undefined ? undefined : this.entryStart(entryIndex);
  }

  private previous(position: HistoryPosition): HistoryPosition | undefined {
    if (position.lineOffset > 0) return { ...position, lineOffset: position.lineOffset - 1 };
    if (position.segmentIndex > 0) {
      const segmentIndex = position.segmentIndex - 1;
      const previous = { ...position, segmentIndex };
      return { ...previous, lineOffset: Math.max(0, this.block(previous).length - 1) };
    }
    if (position.pageIndex > 0) {
      const pageIndex = position.pageIndex - 1;
      const segmentIndex = this.segmentCount(position.entryIndex, pageIndex) - 1;
      const previous = { ...position, pageIndex, segmentIndex };
      return { ...previous, lineOffset: Math.max(0, this.block(previous).length - 1) };
    }
    const entryIndex = this.firstVisibleEntry(position.entryIndex - 1, -1);
    if (entryIndex === undefined || entryIndex < this.range.startIndex) return undefined;
    return this.entryEnd(entryIndex);
  }

  private entryStart(entryIndex: number): HistoryPosition {
    return { entryIndex, lineOffset: 0, pageIndex: 0, segmentIndex: 0 };
  }

  private entryEnd(entryIndex: number): HistoryPosition {
    const pageIndex = this.pageCount(entryIndex) - 1;
    const segmentIndex = this.segmentCount(entryIndex, pageIndex) - 1;
    const position = { entryIndex, lineOffset: 0, pageIndex, segmentIndex };
    return { ...position, lineOffset: Math.max(0, this.block(position).length - 1) };
  }

  private ensurePosition(): HistoryPosition {
    this.top ??= this.newestTop();
    return this.top;
  }

  private newestTop(): HistoryPosition {
    const entryIndex = this.firstVisibleEntry(this.index.entries.length - 1, -1);
    if (entryIndex === undefined) return this.entryStart(Math.max(0, this.range.startIndex));
    let position = this.entryEnd(entryIndex);
    for (let index = 1; index < this.viewportHeight; index += 1) {
      const previous = this.previous(position);
      if (!previous) break;
      position = previous;
    }
    return position;
  }

  private resize(width: number, height: number): void {
    const wasAtNewest = this.top ? this.viewportEndsAtNewest(this.top) : true;
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const layoutChanged = this.width !== nextWidth || this.viewportHeight !== nextHeight;
    this.width = nextWidth;
    this.viewportHeight = nextHeight;
    if (!this.top || wasAtNewest) {
      this.top = this.newestTop();
      return;
    }
    if (!layoutChanged) return;
    const pageIndex = Math.min(this.top.pageIndex, this.pageCount(this.top.entryIndex) - 1);
    const segmentIndex = Math.min(
      this.top.segmentIndex,
      this.segmentCount(this.top.entryIndex, pageIndex) - 1,
    );
    const position = { ...this.top, pageIndex, segmentIndex };
    this.top = {
      ...position,
      lineOffset: Math.min(position.lineOffset, this.block(position).length - 1),
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

  private admitUntilFilterVisible(): void {
    while (!this.hasVisibleEntries() && this.range.loadOlder()) {
      // A direct filter request may admit older windows until one row matches.
    }
  }

  private entryVisible(entryIndex: number): boolean {
    const entry = this.index.entries[entryIndex];
    return entry !== undefined && historyEntryMatchesFilter(entry, this.filterValue);
  }

  private hasVisibleEntries(): boolean {
    return this.firstVisibleEntry(this.range.startIndex, 1) !== undefined;
  }

  private firstVisibleEntry(start: number, direction: 1 | -1): number | undefined {
    for (
      let entryIndex = start;
      entryIndex >= this.range.startIndex && entryIndex < this.index.entries.length;
      entryIndex += direction
    ) {
      if (this.entryVisible(entryIndex)) return entryIndex;
    }
    return undefined;
  }

  private nearestVisibleEntry(entryIndex: number): number | undefined {
    for (let distance = 0; distance < this.index.entries.length; distance += 1) {
      const backward = entryIndex - distance;
      if (backward >= this.range.startIndex && this.entryVisible(backward)) return backward;
      const forward = entryIndex + distance;
      if (forward < this.index.entries.length && this.entryVisible(forward)) return forward;
    }
    return undefined;
  }

  private updateCurrentState(update: EntryDisplayOverride): boolean {
    const entryIndex = this.currentEntryIndex;
    if (entryIndex === undefined) return false;
    const currentOverride = this.entryOverrides.get(entryIndex) ?? {};
    this.entryOverrides.set(entryIndex, { ...currentOverride, ...update });
    this.renderer.clear();
    const current = this.top;
    if (current?.entryIndex === entryIndex) {
      const pageIndex = Math.min(current.pageIndex, this.pageCount(entryIndex) - 1);
      const segmentIndex = Math.min(
        current.segmentIndex,
        this.segmentCount(entryIndex, pageIndex) - 1,
      );
      this.top = { entryIndex, lineOffset: 0, pageIndex, segmentIndex };
    }
    return true;
  }

  private revealSection(entryIndex: number, section: HistorySectionKind | undefined): void {
    const current = this.entryOverrides.get(entryIndex) ?? {};
    this.entryOverrides.set(entryIndex, {
      ...current,
      detailed: true,
      ...(section === "diff" ? { showDiffs: true } : {}),
      ...(section === "thinking" ? { showThinking: true } : {}),
      ...(section === "toolOutput" ? { showToolOutput: true } : {}),
    });
    this.renderer.clear();
  }

  private emptyRows(message: string): readonly string[] {
    return [
      this.theme.fg("dim", message),
      ...Array.from({ length: this.viewportHeight - 1 }, () => ""),
    ];
  }

  private location(): HistoryLocation | undefined {
    const position = this.top;
    return position
      ? { filter: this.filterValue, focusEntryIndex: this.focusEntryIndex, position }
      : undefined;
  }

  private recordLocation(): void {
    const location = this.location();
    if (location) this.history.record(location);
  }

  private restoreLocation(location: HistoryLocation): void {
    this.filterValue = location.filter;
    this.range.admitEntry(location.position.entryIndex);
    this.focusEntryIndex = location.focusEntryIndex;
    this.top = location.position;
    this.renderer.clear();
  }
}
