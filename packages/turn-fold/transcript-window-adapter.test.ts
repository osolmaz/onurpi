import { describe, expect, it, vi } from "vitest";

import {
  installTranscriptWindowAdapter,
  type TranscriptSessionManager,
} from "./transcript-window-adapter.ts";
import type { TranscriptWindowValue } from "./transcript-windows.ts";

type Entries = ReturnType<TranscriptSessionManager["getBranch"]>;
type Entry = Entries[number];

function custom(id: string): Entry {
  return {
    customType: "test",
    data: {},
    id,
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "custom",
  };
}

function user(id: string): Entry {
  return {
    id,
    message: { content: id, role: "user", timestamp: 1 },
    parentId: null,
    timestamp: "2026-07-22T00:00:00.000Z",
    type: "message",
  };
}

function compaction(id: string): Entry {
  return {
    firstKeptEntryId: id,
    id,
    parentId: null,
    summary: id,
    timestamp: "2026-07-22T00:00:00.000Z",
    tokensBefore: 1,
    type: "compaction",
  };
}

function manager(entries: Entries): TranscriptSessionManager {
  return {
    buildContextEntries: vi.fn(() => []),
    getBranch: vi.fn(() => entries),
  };
}

function install(entries: Entries, value: TranscriptWindowValue = 1) {
  const sessionManager = manager(entries);
  const adapter = installTranscriptWindowAdapter(sessionManager, value);
  return { adapter, sessionManager };
}

describe("transcript window adapter", () => {
  it("projects the configured branch range into the TUI path", () => {
    const branch = [user("old"), compaction("c1"), user("recent"), compaction("c2"), custom("now")];
    const { sessionManager } = install(branch, 1);

    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual([
      "recent",
      "c2",
      "now",
    ]);
  });

  it("updates the projection without reinstalling the wrapper", () => {
    const branch = [user("old"), compaction("c1"), user("recent"), compaction("c2"), custom("now")];
    const { adapter, sessionManager } = install(branch, 1);
    const wrapper = sessionManager.buildContextEntries;

    adapter.setValue(2);

    expect(sessionManager.buildContextEntries).toBe(wrapper);
    expect(adapter.getValue()).toBe(2);
    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual([
      "old",
      "c1",
      "recent",
      "c2",
      "now",
    ]);
  });

  it("reuses stable state across extension reloads", () => {
    const branch = [user("old"), compaction("c1"), user("recent"), compaction("c2"), custom("now")];
    const sessionManager = manager(branch);
    const first = installTranscriptWindowAdapter(sessionManager, 1);
    const second = installTranscriptWindowAdapter(sessionManager, "all");

    expect(second).toBe(first);
    expect(second.getValue()).toBe("all");
    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual(
      branch.map((entry) => entry.id),
    );
  });

  it("omits a pending persisted compaction from one rebuild", () => {
    const branch = [user("old"), compaction("c1"), custom("now")];
    const { adapter, sessionManager } = install(branch, 1);
    adapter.markPendingCompaction("c1");

    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual(["old", "now"]);
    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual([
      "old",
      "c1",
      "now",
    ]);
  });

  it("clears invalid pending state after reporting the mismatch", () => {
    const branch = [user("old"), compaction("c1"), custom("now")];
    const { adapter, sessionManager } = install(branch, 1);
    adapter.markPendingCompaction("missing");

    expect(() => sessionManager.buildContextEntries()).toThrow(
      "Pending Turn Fold compaction missing is absent from the selected transcript",
    );
    expect(sessionManager.buildContextEntries().map((entry) => entry.id)).toEqual([
      "old",
      "c1",
      "now",
    ]);
  });

  it("leaves the model-context builder untouched", () => {
    const buildSessionContext = vi.fn(() => ({ messages: ["compacted"] }));
    const sessionManager = {
      ...manager([user("old"), compaction("c1"), custom("now")]),
      buildSessionContext,
    };

    installTranscriptWindowAdapter(sessionManager, "all");

    expect(sessionManager.buildSessionContext()).toEqual({ messages: ["compacted"] });
    expect(buildSessionContext).toHaveBeenCalledOnce();
  });

  it("rejects empty pending IDs and non-extensible managers", () => {
    const extensible = install([custom("now")]);
    expect(() => {
      extensible.adapter.markPendingCompaction("");
    }).toThrow("Pending compaction entry ID must not be empty");

    const frozen = Object.preventExtensions(manager([custom("now")]));
    expect(() => installTranscriptWindowAdapter(frozen, 1)).toThrow(
      "Unable to install Turn Fold transcript-window state",
    );
  });
});
