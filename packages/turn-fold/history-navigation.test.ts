import { describe, expect, it } from "vitest";

import { createHistoryIndex } from "./history-index.ts";
import {
  BoundedNavigationHistory,
  HistoryJumpIndex,
  parseHistoryJump,
} from "./history-navigation.ts";

function message(id: string, role: string, timestamp: number): unknown {
  return { id, message: { content: id, role, timestamp }, type: "message" };
}

describe("Turn Fold history navigation", () => {
  it("parses direct jump forms", () => {
    expect(parseHistoryJump("w3")).toEqual({ kind: "window", number: 3 });
    expect(parseHistoryJump("turn 2")).toEqual({ kind: "turn", number: 2 });
    expect(parseHistoryJump("m1")).toEqual({ kind: "match", number: 1 });
    expect(parseHistoryJump("@17:15")).toEqual({ kind: "timestamp", value: "17:15" });
    expect(parseHistoryJump("oldest")).toEqual({ kind: "oldest" });
    expect(parseHistoryJump("w0")).toBeUndefined();
    expect(parseHistoryJump("nope")).toBeUndefined();
  });

  it("bounds back and forward stacks", () => {
    const history = new BoundedNavigationHistory<number>(2);
    history.record(1);
    history.record(2);
    history.record(3);

    expect(history.backwardCount).toBe(2);
    expect(history.back(4)).toBe(3);
    expect(history.back(3)).toBe(2);
    expect(history.back(2)).toBeUndefined();
    expect(history.next(2)).toBe(3);
    expect(history.forwardCount).toBe(1);
  });

  it("clears forward history after a new jump", () => {
    const history = new BoundedNavigationHistory<number>();
    history.record(1);
    expect(history.back(2)).toBe(1);
    history.record(3);
    expect(history.next(4)).toBeUndefined();
  });

  it("resolves windows, turns, matches, and endpoints", () => {
    const index = createHistoryIndex([
      message("user-1", "user", 1),
      message("assistant-1", "assistant", 2),
      { id: "compaction", summary: "summary", type: "compaction" },
      message("user-2", "user", 3),
    ]);
    const jumps = new HistoryJumpIndex(index);
    const matches = [{ entryIndex: 1, section: "text" as const, snippet: "match" }];

    expect(jumps.totalTurns).toBe(2);
    expect(jumps.resolve({ kind: "window", number: 2 }, matches)).toMatchObject({
      entryIndex: 2,
      ok: true,
    });
    expect(jumps.resolve({ kind: "turn", number: 2 }, matches)).toMatchObject({
      entryIndex: 3,
      ok: true,
    });
    expect(jumps.resolve({ kind: "match", number: 1 }, matches)).toMatchObject({
      entryIndex: 1,
      ok: true,
    });
    expect(jumps.resolve({ kind: "oldest" }, matches)).toMatchObject({ entryIndex: 0, ok: true });
    expect(jumps.resolve({ kind: "newest" }, matches)).toMatchObject({ entryIndex: 3, ok: true });
  });

  it("resolves nearest time and exact timestamp", () => {
    const morning = new Date(2026, 7, 4, 9, 0).getTime();
    const evening = new Date(2026, 7, 4, 17, 10).getTime();
    const jumps = new HistoryJumpIndex(
      createHistoryIndex([
        message("morning", "assistant", morning),
        message("evening", "assistant", evening),
      ]),
    );

    expect(jumps.resolve({ kind: "timestamp", value: "17:15" }, [])).toMatchObject({
      entryIndex: 1,
      ok: true,
    });
    expect(jumps.resolve({ kind: "timestamp", value: String(morning) }, [])).toMatchObject({
      entryIndex: 0,
      ok: true,
    });
  });

  it("reports invalid and unavailable targets without moving", () => {
    const jumps = new HistoryJumpIndex(createHistoryIndex([message("one", "assistant", 1)]));

    expect(jumps.resolve({ kind: "turn", number: 1 }, [])).toEqual({
      error: "Turn 1 is unavailable.",
      ok: false,
    });
    expect(jumps.resolve({ kind: "timestamp", value: "bad" }, [])).toEqual({
      error: "No entry matches timestamp bad.",
      ok: false,
    });
  });
});
