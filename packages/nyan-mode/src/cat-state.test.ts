import { describe, expect, it } from "vitest";

import { createCatState, reduceCatState, selectCatMood, type CatState } from "./cat-state.ts";

function started(nowMs = 0): CatState {
  return reduceCatState(createCatState(), { type: "stream_started", nowMs });
}

function finish(state: CatState, toolCallId: string, isError: boolean, nowMs: number): CatState {
  return reduceCatState(state, { type: "tool_finished", toolCallId, isError, nowMs });
}

describe("cat state machine", () => {
  it("moves through duration-driven moods", () => {
    const state = started();
    expect(selectCatMood(state, 0)).toBe("dancing");
    expect(selectCatMood(state, 15_000)).toBe("thinking");
    expect(selectCatMood(state, 22_500)).toBe("dancing");
    expect(selectCatMood(state, 30_000)).toBe("focused");
    expect(selectCatMood(state, 45_000)).toBe("thinking");
    expect(selectCatMood(state, 53_000)).toBe("focused");
    expect(selectCatMood(state, 90_000)).toBe("unimpressed");
    expect(selectCatMood(state, 150_000)).toBe("annoyed");
    expect(selectCatMood(state, 240_000)).toBe("angry");
  });

  it("focuses on tools and briefly celebrates success", () => {
    const state = started(1_000);
    const focused = reduceCatState(state, { type: "tool_started", toolCallId: "tool-1" });
    expect(selectCatMood(focused, 2_000)).toBe("focused");

    const pleased = finish(focused, "tool-1", false, 3_000);
    expect(selectCatMood(pleased, 3_500)).toBe("pleased");
    expect(selectCatMood(pleased, 7_001)).toBe("dancing");
    expect(pleased.activeToolIds.size).toBe(0);
  });

  it("escalates recent and repeated tool errors", () => {
    const first = finish(started(), "tool-1", true, 1_000);
    expect(selectCatMood(first, 1_000)).toBe("annoyed");
    expect(selectCatMood(first, 13_001)).toBe("dancing");

    const second = finish(first, "tool-2", true, 14_000);
    expect(selectCatMood(second, 14_000)).toBe("angry");

    const recovered = finish(second, "tool-3", false, 15_000);
    expect(recovered.consecutiveErrors).toBe(0);
    expect(selectCatMood(recovered, 15_000)).toBe("annoyed");
  });

  it("remembers accumulated errors without making anger permanent", () => {
    let state = started();
    state = finish(state, "1", true, 1_000);
    state = finish(state, "ok-1", false, 2_000);
    state = finish(state, "2", true, 3_000);
    state = finish(state, "ok-2", false, 4_000);
    state = finish(state, "3", true, 5_000);
    state = finish(state, "ok-3", false, 6_000);
    state = finish(state, "4", true, 7_000);

    expect(state.errorCount).toBe(4);
    expect(selectCatMood(state, 20_000)).toBe("unimpressed");
    expect(selectCatMood(state, 68_000)).toBe("thinking");
  });

  it("resets run-local activity while retaining session error history", () => {
    const failed = finish(started(), "tool-1", true, 1_000);
    const stopped = reduceCatState(failed, { type: "stream_stopped" });
    expect(selectCatMood(stopped, 2_000)).toBe("neutral");
    expect(stopped.activeToolIds.size).toBe(0);

    const restarted = reduceCatState(stopped, { type: "stream_started", nowMs: 3_000 });
    expect(restarted.errorCount).toBe(1);
    expect(restarted.consecutiveErrors).toBe(0);
    expect(selectCatMood(restarted, 55_001)).toBe("thinking");
  });

  it("tracks concurrent tools without mutating prior states", () => {
    const initial = started();
    const first = reduceCatState(initial, { type: "tool_started", toolCallId: "a" });
    const second = reduceCatState(first, { type: "tool_started", toolCallId: "b" });
    const duplicate = reduceCatState(second, { type: "tool_started", toolCallId: "b" });
    expect(initial.activeToolIds.size).toBe(0);
    expect(second.activeToolIds.size).toBe(2);
    expect(duplicate.activeToolIds.size).toBe(2);
  });
});
