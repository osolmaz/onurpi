import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";

import { PromptHistory } from "./history-model.ts";
import { ManagerWindow } from "./manager-window.ts";
import { PromptQueue } from "./queue-model.ts";
import { type ManagerResult, ManagerWindowState } from "./window-state.ts";

function setup(queueTexts: string[] = ["queued prompt"], historyTexts: string[] = []) {
  const queue = new PromptQueue();
  for (const text of queueTexts) queue.add(text, "queue");
  const history = new PromptHistory();
  for (const text of historyTexts) history.add(text);
  const state = new ManagerWindowState(queue, history);
  const requestRender = vi.fn();
  const tui = { requestRender } as unknown as TUI;
  const theme = {
    bold: (text: string) => text,
    fg: (_color: string, text: string) => text,
  } as unknown as Theme;
  const done = vi.fn<(result: ManagerResult) => void>();
  const window = new ManagerWindow(state, tui, theme, done);
  return { done, queue, requestRender, state, window };
}

describe("ManagerWindow shortcuts", () => {
  it("uses m for mode and d for delete while leaving x unbound", () => {
    const { queue, state, window } = setup(["one", "two"]);

    window.handleInput("m");
    expect(state.selection()?.mode).toBe("steer");

    window.handleInput("x");
    expect(queue.size).toBe(2);

    window.handleInput("d");
    expect(queue.items().map((item) => item.text)).toEqual(["two"]);
  });

  it("uses s to remove and return a queued prompt for immediate delivery", () => {
    const { done, queue, window } = setup();

    window.handleInput("s");

    expect(done).toHaveBeenCalledWith({ kind: "send-now", text: "queued prompt" });
    expect(queue.size).toBe(0);
  });

  it("can send a history prompt without deleting it", () => {
    const { done, state, window } = setup([], ["past prompt"]);

    window.handleInput("s");

    expect(done).toHaveBeenCalledWith({ kind: "send-now", text: "past prompt" });
    expect(state.historyCount()).toBe(1);
  });

  it("renders the updated shortcut hint", () => {
    const { window } = setup();

    expect(window.render(180).join("\n")).toContain("m mode · s send now · d delete · p/n reorder");
  });
});
