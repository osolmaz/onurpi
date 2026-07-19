import { describe, expect, it, vi } from "vitest";

import {
  getPatchState,
  installChronologicalTranscriptPatch,
  type BranchEntries,
  type TranscriptSessionManager,
} from "./history-replay.ts";

function branch(...ids: string[]): BranchEntries {
  return ids.map((id, index): BranchEntries[number] => ({
    customType: "test",
    data: {},
    id,
    parentId: index === 0 ? null : (ids[index - 1] ?? null),
    timestamp: `2026-07-19T00:00:0${String(index)}.000Z`,
    type: "custom",
  }));
}

function manager(entries: BranchEntries): TranscriptSessionManager {
  return {
    buildContextEntries: vi.fn(() => []),
    getBranch: vi.fn(() => entries),
  };
}

describe("history replay patch", () => {
  it("replaces compacted rendering entries with the full active branch", () => {
    const entries = branch("before", "compaction", "after");
    const sessionManager = manager(entries);

    installChronologicalTranscriptPatch(sessionManager);

    expect(sessionManager.buildContextEntries()).toEqual(entries);
  });

  it("omits a pending compaction once to avoid a duplicate live summary", () => {
    const entries = branch("before", "compaction", "after");
    const sessionManager = manager(entries);
    const state = installChronologicalTranscriptPatch(sessionManager);
    state.pendingCompactionEntryId = "compaction";

    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual([
      "before",
      "after",
    ]);
    expect(state.pendingCompactionEntryId).toBeUndefined();
    expect(sessionManager.buildContextEntries()).toEqual(entries);
  });

  it("rejects a pending compaction outside the active branch", () => {
    const sessionManager = manager(branch("before", "after"));
    const state = installChronologicalTranscriptPatch(sessionManager);
    state.pendingCompactionEntryId = "missing";

    expect(() => sessionManager.buildContextEntries()).toThrow(
      "Pending TUI compaction entry missing is absent from the active branch",
    );
  });

  it("omits a pending compaction at the start of the branch", () => {
    const sessionManager = manager(branch("compaction", "after"));
    const state = installChronologicalTranscriptPatch(sessionManager);
    state.pendingCompactionEntryId = "compaction";

    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual(["after"]);
  });

  it("reuses immutable hidden patch state under the stable global symbol", () => {
    const sessionManager = manager(branch("entry"));

    const first = getPatchState(sessionManager);
    const second = installChronologicalTranscriptPatch(sessionManager);
    const symbols = Object.getOwnPropertySymbols(sessionManager);
    const symbol = symbols[0];
    if (!symbol) throw new Error("Patch state symbol is missing");

    expect(second).toBe(first);
    expect(Symbol.keyFor(symbol)).toBe("pi.tui-history-replay.chronological-branch.v1");
    expect(Object.getOwnPropertyDescriptor(sessionManager, symbol)).toMatchObject({
      configurable: false,
      enumerable: false,
      writable: false,
    });
  });

  it("fails clearly when patch state cannot be attached", () => {
    const sessionManager = Object.preventExtensions(manager(branch("entry")));

    expect(() => getPatchState(sessionManager)).toThrow(
      "Unable to persist TUI history replay patch state on SessionManager",
    );
  });
});
