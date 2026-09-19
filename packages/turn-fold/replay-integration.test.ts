import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import turnFold from "./index.ts";
import { replayProjectionMethod } from "./replay-projection.ts";
import { clearRestartMarker } from "./restart-marker.ts";
import { context, emit, entryId, extensionHarness, replayRecorder } from "./test-support.ts";

const historyViewerMock = vi.hoisted(() => ({ entries: [] as (readonly unknown[])[] }));

vi.mock("./history-viewer.ts", () => ({
  showHistoryExplorer: (_ctx: unknown, entries: readonly unknown[]) => {
    historyViewerMock.entries.push(entries);
    return Promise.resolve();
  },
}));

vi.mock("./render-patches.ts", () => ({
  installRenderPatches: () => () => undefined,
}));

function replayThroughPi(entries: readonly unknown[]): void {
  Reflect.apply(
    replayProjectionMethod(InteractiveMode.prototype) as (
      this: object,
      replayed: readonly unknown[],
    ) => void,
    {},
    [entries],
  );
}

afterEach(() => {
  clearRestartMarker();
  historyViewerMock.entries.length = 0;
  vi.clearAllMocks();
});

describe("Turn Fold transcript replay projection", () => {
  it("replays the compact projection and keeps older windows visible", async () => {
    const recorder = replayRecorder();
    try {
      const extension = extensionHarness();
      const branch = [
        { id: "u0", message: { role: "user" }, type: "message" },
        { id: "c1", type: "compaction" },
        { id: "u1", message: { role: "user" }, type: "message" },
        { id: "c2", type: "compaction" },
        { id: "u2", message: { role: "user" }, type: "message" },
        { id: "now", type: "custom" },
      ];
      const ctx = context([{ id: "c2", type: "compaction" }, { id: "u2" }], branch);
      turnFold(extension.pi);
      await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

      replayThroughPi(ctx.sessionManager.buildContextEntries());

      const projectedIds = (recorder.entries.at(-1) ?? []).map(entryId);
      expect(projectedIds).toContain("u0");
      expect(projectedIds).toContain("u2");
      expect(projectedIds.indexOf("u0")).toBeLessThan(projectedIds.indexOf("u2"));
      expect(projectedIds.filter((id) => id === "c2")).toHaveLength(1);
    } finally {
      recorder.restore();
    }
  });

  it("bounds the replay projection by the configured windows", async () => {
    const recorder = replayRecorder();
    try {
      const extension = extensionHarness();
      const branch = [
        {
          customType: "onurpi-turn-fold-config",
          data: { preCompaction: "show", windows: 1 },
          id: "config",
          type: "custom",
        },
        { id: "u0", message: { role: "user" }, type: "message" },
        { id: "c1", type: "compaction" },
        { id: "u1", message: { role: "user" }, type: "message" },
        { id: "c2", type: "compaction" },
        { id: "u2", message: { role: "user" }, type: "message" },
      ];
      const ctx = context([{ id: "c2", type: "compaction" }, { id: "u2" }], branch);
      turnFold(extension.pi);
      await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

      replayThroughPi([
        { id: "c2", type: "compaction" },
        { id: "u2", type: "message" },
      ]);

      const projectedIds = (recorder.entries.at(-1) ?? []).map(entryId);
      // The projection adds the pre-compaction window entry that Pi never offered, so a recorder that
      // only sees Pi's own list cannot satisfy this assertion.
      expect(projectedIds).toContain("u1");
      expect(projectedIds).toContain("u2");
      expect(projectedIds).not.toContain("u0");
      expect(projectedIds).not.toContain("c1");
    } finally {
      recorder.restore();
    }
  });

  it("leaves the transcript replay entry point untouched outside TUI mode", async () => {
    const extension = extensionHarness();
    const entries = [{ id: "entry", type: "custom" }];
    const ctx = context(entries);
    ctx.mode = "rpc";
    const originalReplay = replayProjectionMethod();
    turnFold(extension.pi);

    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);

    expect(replayProjectionMethod()).toBe(originalReplay);
    expect(ctx.sessionManager.buildContextEntries()).toBe(entries);
  });

  it("keeps Pi's native context for every reader while a session compacts", async () => {
    const extension = extensionHarness();
    const nativeEntries = [
      { id: "c1", type: "compaction" },
      { id: "u1", message: { role: "user" }, type: "message" },
    ];
    const branch = [...nativeEntries, { id: "c2", type: "compaction" }];
    const ctx = context(nativeEntries, branch);
    const manager = ctx.sessionManager;
    const original = manager.buildContextEntries;
    turnFold(extension.pi);

    await emit(extension.handlers, "session_start", { type: "session_start" }, ctx);
    await emit(
      extension.handlers,
      "session_compact",
      {
        compactionEntry: { id: "c2", timestamp: new Date(10).toISOString(), type: "compaction" },
        reason: "threshold",
        type: "session_compact",
      },
      ctx,
    );
    const secondReader = manager.buildContextEntries();

    expect(manager.buildContextEntries).toBe(original);
    expect(secondReader[0]).toEqual({ id: "c1", type: "compaction" });
    expect(secondReader).toBe(nativeEntries);

    await emit(
      extension.handlers,
      "session_shutdown",
      { reason: "quit", type: "session_shutdown" },
      ctx,
    );
  });

  it("runs every session hook with a frozen session manager", async () => {
    const extension = extensionHarness();
    const nativeEntries = [
      { id: "c1", type: "compaction" },
      { id: "u1", message: { role: "user" }, type: "message" },
    ];
    const branch = [...nativeEntries, { id: "c2", type: "compaction" }];
    const ctx = context(nativeEntries, branch);
    const manager = ctx.sessionManager;
    Object.freeze(manager);
    turnFold(extension.pi);

    await expect(
      emit(extension.handlers, "session_start", { type: "session_start" }, ctx),
    ).resolves.toBeUndefined();
    await expect(
      emit(
        extension.handlers,
        "session_compact",
        {
          compactionEntry: { id: "c2", timestamp: new Date(10).toISOString(), type: "compaction" },
          reason: "threshold",
          type: "session_compact",
        },
        ctx,
      ),
    ).resolves.toBeUndefined();
    await expect(
      emit(extension.handlers, "session_tree", { type: "session_tree" }, ctx),
    ).resolves.toBeUndefined();
    await expect(
      emit(
        extension.handlers,
        "session_shutdown",
        { reason: "quit", type: "session_shutdown" },
        ctx,
      ),
    ).resolves.toBeUndefined();

    expect(manager.buildContextEntries()).toBe(nativeEntries);
  });
});
