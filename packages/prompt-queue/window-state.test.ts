import { describe, expect, it } from "vitest";

import { PromptHistory } from "./history-model.ts";
import { PromptQueue } from "./queue-model.ts";
import { ManagerWindowState, viewportSlice } from "./window-state.ts";

function makeState(queueTexts: string[], historyTexts: string[]): ManagerWindowState {
  const queue = new PromptQueue();
  for (const text of queueTexts) queue.add(text, "queue");
  const history = new PromptHistory();
  for (const text of historyTexts) history.add(text);
  return new ManagerWindowState(queue, history);
}

describe("viewportSlice", () => {
  it("shows everything when it fits", () => {
    expect(viewportSlice(3, 0, 5)).toEqual({ start: 0, end: 3 });
  });

  it("centers the selection within the viewport", () => {
    expect(viewportSlice(10, 5, 4)).toEqual({ start: 3, end: 7 });
  });

  it("clamps at the start and end", () => {
    expect(viewportSlice(10, 0, 4)).toEqual({ start: 0, end: 4 });
    expect(viewportSlice(10, 9, 4)).toEqual({ start: 6, end: 10 });
  });
});

describe("ManagerWindowState tabs", () => {
  it("opens on the queue tab when anything is pending", () => {
    expect(makeState(["q1"], ["h1"]).activeTab()).toBe("queue");
  });

  it("opens on the history tab when the queue is empty", () => {
    expect(makeState([], ["h1"]).activeTab()).toBe("history");
    expect(makeState([], []).activeTab()).toBe("history");
  });

  it("toggles between tabs and resets the cursor", () => {
    const state = makeState(["q1", "q2"], ["h1", "h2"]);
    state.moveCursor(1);
    expect(state.toggleTab()).toBe(true);
    expect(state.activeTab()).toBe("history");
    expect(state.selection()?.text).toBe("h2");
    expect(state.toggleTab()).toBe(true);
    expect(state.activeTab()).toBe("queue");
    expect(state.selection()?.text).toBe("q1");
  });

  it("reports no change when setting the already-active tab", () => {
    const state = makeState(["q1"], []);
    expect(state.setTab("queue")).toBe(false);
    expect(state.setTab("history")).toBe(true);
  });

  it("exposes counts for both tabs regardless of the active one", () => {
    const state = makeState(["q1", "q2"], ["h1"]);
    expect(state.queueCount()).toBe(2);
    expect(state.historyCount()).toBe(1);
    state.toggleTab();
    expect(state.queueCount()).toBe(2);
    expect(state.historyCount()).toBe(1);
  });
});

describe("ManagerWindowState", () => {
  it("lists only the active tab's entries", () => {
    const state = makeState(["q1"], ["h1"]);
    expect(state.entries()).toEqual([
      { target: { kind: "queue", id: 1 }, text: "q1", mode: "queue" },
    ]);
    state.toggleTab();
    expect(state.entries()).toEqual([{ target: { kind: "history", index: 0 }, text: "h1" }]);
  });

  it("builds the exact row list for the queue tab", () => {
    const state = makeState(["q1", "q2"], ["h1"]);
    state.moveCursor(1);
    expect(state.rows()).toEqual([
      {
        kind: "entry",
        entry: { target: { kind: "queue", id: 1 }, text: "q1", mode: "queue" },
        selected: false,
      },
      {
        kind: "entry",
        entry: { target: { kind: "queue", id: 2 }, text: "q2", mode: "queue" },
        selected: true,
      },
    ]);
  });

  it("builds the exact row list for the history tab", () => {
    const state = makeState([], ["h1", "h2"]);
    state.moveCursor(1);
    expect(state.rows()).toEqual([
      {
        kind: "entry",
        entry: { target: { kind: "history", index: 0 }, text: "h2" },
        selected: false,
      },
      {
        kind: "entry",
        entry: { target: { kind: "history", index: 1 }, text: "h1" },
        selected: true,
      },
    ]);
  });

  it("shows a placeholder row on an empty tab", () => {
    const state = makeState([], []);
    expect(state.rows()).toEqual([{ kind: "empty", label: "no prompts yet" }]);
    state.setTab("queue");
    expect(state.rows()).toEqual([{ kind: "empty", label: "nothing queued" }]);
  });

  it("moves the cursor within bounds and reports changes", () => {
    const state = makeState(["q1", "q2"], []);
    expect(state.moveCursor(-1)).toBe(false);
    expect(state.moveCursor(1)).toBe(true);
    expect(state.moveCursor(1)).toBe(false);
    expect(state.selection()?.text).toBe("q2");
  });

  it("returns no selection when everything is empty", () => {
    const state = makeState([], []);
    expect(state.selection()).toBeUndefined();
    expect(state.moveCursor(1)).toBe(false);
    expect(state.deleteSelected()).toBe(false);
    expect(state.moveSelected(1)).toBe(false);
    expect(state.takeSelected()).toBeUndefined();
  });

  it("deletes the selected queue item and clamps the cursor", () => {
    const state = makeState(["q1", "q2"], ["h1"]);
    state.moveCursor(1);
    expect(state.deleteSelected()).toBe(true);
    expect(state.activeTab()).toBe("queue");
    expect(state.selection()?.text).toBe("q1");
  });

  it("switches to the history tab when the last queue item is deleted", () => {
    const state = makeState(["q1"], ["h1", "h2"]);
    state.moveCursor(1);
    expect(state.deleteSelected()).toBe(true);
    expect(state.activeTab()).toBe("history");
    expect(state.selection()?.text).toBe("h2");
  });

  it("deletes the selected history entry without switching tabs", () => {
    const state = makeState([], ["h1", "h2"]);
    expect(state.selection()?.text).toBe("h2");
    expect(state.deleteSelected()).toBe(true);
    expect(state.activeTab()).toBe("history");
    expect(state.entries().map((entry) => entry.text)).toEqual(["h1"]);
  });

  it("toggles the selected queue item between queue and steer", () => {
    const state = makeState(["q1", "q2"], []);
    state.moveCursor(1);
    expect(state.toggleSelectedMode()).toBe(true);
    expect(state.selection()?.mode).toBe("steer");
    expect(state.entries()[0]?.mode).toBe("queue");
    expect(state.toggleSelectedMode()).toBe(true);
    expect(state.selection()?.mode).toBe("queue");
  });

  it("refuses to toggle mode on the history tab or when empty", () => {
    const state = makeState([], ["h1"]);
    expect(state.toggleSelectedMode()).toBe(false);
    expect(makeState([], []).toggleSelectedMode()).toBe(false);
  });

  it("reorders queue items and keeps the cursor on the moved item", () => {
    const state = makeState(["q1", "q2"], []);
    expect(state.moveSelected(1)).toBe(true);
    expect(state.entries().map((entry) => entry.text)).toEqual(["q2", "q1"]);
    expect(state.selection()?.text).toBe("q1");
    expect(state.moveSelected(-1)).toBe(true);
    expect(state.entries().map((entry) => entry.text)).toEqual(["q1", "q2"]);
    expect(state.selection()?.text).toBe("q1");
  });

  it("refuses to reorder history entries or move past the ends", () => {
    const state = makeState(["q1"], ["h1"]);
    expect(state.moveSelected(-1)).toBe(false);
    expect(state.moveSelected(1)).toBe(false);
    expect(state.selection()?.text).toBe("q1");
    state.toggleTab();
    expect(state.moveSelected(1)).toBe(false);
    expect(state.moveSelected(-1)).toBe(false);
    expect(state.selection()?.text).toBe("h1");
  });

  it("takes history entries without touching the history list", () => {
    const state = makeState([], ["h1"]);
    expect(state.takeSelected()).toBe("h1");
    expect(state.entries()).toHaveLength(1);
  });

  it("takes queue items and removes them from the queue", () => {
    const state = makeState(["q1"], []);
    expect(state.takeSelected()).toBe("q1");
    expect(state.queueCount()).toBe(0);
  });
});
