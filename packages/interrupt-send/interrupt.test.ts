import { describe, expect, it, vi } from "vitest";

import { NOTHING_TO_SEND, runInterruptSend, type InterruptTarget } from "./interrupt.ts";

function target(options: {
  queue?: { followUp?: string[]; steering?: string[] };
  streaming?: boolean;
  compacting?: boolean;
  text?: string;
}) {
  const submitted: string[] = [];
  const statuses: string[] = [];
  const abort = vi.fn(() => Promise.resolve());
  const steer = vi.fn((text: string) => Promise.resolve(text));
  const followUp = vi.fn((text: string) => Promise.resolve(text));
  const setText = vi.fn();
  const queue = {
    followUp: options.queue?.followUp ?? [],
    steering: options.queue?.steering ?? [],
  };
  const value: InterruptTarget = {
    editor: { getText: () => options.text ?? "", setText },
    session: {
      abort,
      clearQueue: () => queue,
      followUp,
      isCompacting: options.compacting ?? false,
      isStreaming: options.streaming ?? false,
      steer,
    },
    showStatus: (message: string) => {
      statuses.push(message);
    },
    submit: (text: string) => {
      submitted.push(text);
    },
  };
  return { abort, followUp, setText, statuses, steer, submitted, value };
}

describe("runInterruptSend", () => {
  it("interrupts a running turn and sends the typed text", async () => {
    const { abort, setText, submitted, value } = target({
      streaming: true,
      text: "  stop and read  ",
    });

    await runInterruptSend(value);

    expect(abort).toHaveBeenCalledOnce();
    expect(setText).toHaveBeenCalledWith("");
    expect(submitted).toEqual(["stop and read"]);
  });

  it("prefers the expanded editor text", async () => {
    const { submitted, value } = target({ text: "raw" });
    value.editor.getExpandedText = () => "expanded text";

    await runInterruptSend(value);

    expect(submitted).toEqual(["expanded text"]);
  });

  it("sends without interrupting when the agent is idle", async () => {
    const { abort, submitted, value } = target({ text: "just send" });

    await runInterruptSend(value);

    expect(abort).not.toHaveBeenCalled();
    expect(submitted).toEqual(["just send"]);
  });

  it("interrupts compaction as well", async () => {
    const { abort, submitted, value } = target({ compacting: true, text: "go" });

    await runInterruptSend(value);

    expect(abort).toHaveBeenCalledOnce();
    expect(submitted).toEqual(["go"]);
  });

  it("sends the oldest queued message when the editor is empty", async () => {
    const { abort, followUp, steer, submitted, value } = target({
      queue: { followUp: ["follow"], steering: ["first", "second"] },
      streaming: true,
      text: "   ",
    });

    await runInterruptSend(value);

    expect(abort).toHaveBeenCalledOnce();
    expect(submitted).toEqual(["first"]);
    expect(steer).toHaveBeenCalledWith("second");
    expect(followUp).toHaveBeenCalledWith("follow");
  });

  it("reports an empty queue instead of sending nothing", async () => {
    const { abort, statuses, submitted, value } = target({ streaming: true });

    await runInterruptSend(value);

    expect(submitted).toEqual([]);
    expect(statuses).toEqual([NOTHING_TO_SEND]);
    expect(abort).not.toHaveBeenCalled();
  });

  it("prefers the typed text over the queue", async () => {
    const { steer, submitted, value } = target({
      queue: { followUp: [], steering: ["queued"] },
      text: "typed",
    });

    await runInterruptSend(value);

    expect(submitted).toEqual(["typed"]);
    expect(steer).not.toHaveBeenCalled();
  });
});
