import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_STATUS_NOTES, ProgressEditor, PROGRESS_INTERVAL_MS } from "../src/progress.ts";
import { CHANNEL, FakeTransport } from "./helpers.ts";

function editor(transport: FakeTransport, intervalMs = PROGRESS_INTERVAL_MS) {
  const errors: string[] = [];
  const made = new ProgressEditor({
    channelId: CHANNEL,
    intervalMs,
    log: (event, details) => errors.push(`${event}:${details["error"] ?? ""}`),
    replyTo: "600000000000000006",
    transport,
  });
  return { editor: made, errors };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ProgressEditor", () => {
  it("posts the status message on the first note and edits later notes into it", async () => {
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport, 0);
    progress.note("bash: git status");
    await settle();
    progress.note("Thinking");
    await settle();

    expect(transport.posted).toHaveLength(1);
    expect(transport.posted[0]).toMatchObject({
      channelId: CHANNEL,
      replyTo: "600000000000000006",
      text: "- bash: git status",
    });
    expect(transport.edits).toEqual([
      { channelId: CHANNEL, id: "sent-1", text: "- bash: git status\n- Thinking" },
    ]);
  });

  it("coalesces notes that arrive faster than the interval", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport);
    progress.note("first");
    progress.note("second");
    progress.note("third");
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    expect(transport.posted).toEqual([
      {
        channelId: CHANNEL,
        id: "sent-1",
        replyTo: "600000000000000006",
        text: "- first\n- second\n- third",
      },
    ]);
    expect(transport.edits).toEqual([]);

    progress.note("fourth");
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.edits).toEqual([
      { channelId: CHANNEL, id: "sent-1", text: "- first\n- second\n- third\n- fourth" },
    ]);

    progress.note("fifth");
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.edits).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PROGRESS_INTERVAL_MS);
    expect(transport.edits).toEqual([
      { channelId: CHANNEL, id: "sent-1", text: "- first\n- second\n- third\n- fourth" },
      { channelId: CHANNEL, id: "sent-1", text: "- first\n- second\n- third\n- fourth\n- fifth" },
    ]);
  });

  it("shows the newest notes and keeps the text under Discord's limit", async () => {
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport, 0);
    progress.note("start");
    await settle();
    for (let index = 0; index < MAX_STATUS_NOTES + 2; index += 1) progress.note(`step ${index}`);
    await settle();

    const last = transport.edits.at(-1);
    expect(last?.text).toContain(`- step ${MAX_STATUS_NOTES + 1}`);
    expect(last?.text).not.toContain("- step 0");
    for (const edit of transport.edits) expect(edit.text.length).toBeLessThanOrEqual(1700);
  });

  it("cuts one very long note to Discord's limit", async () => {
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport, 0);
    progress.note("x".repeat(2000));
    await settle();

    expect(transport.posted[0]?.text.length).toBeLessThanOrEqual(1700);
    expect(transport.posted[0]?.text.endsWith("…")).toBe(true);
  });

  it("replaces the status message with the answer and ignores later notes", async () => {
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport, 0);
    progress.note("Thinking");
    await settle();
    await progress.finish("The answer");
    progress.note("late");
    await settle();

    expect(transport.edits.map((item) => item.text)).toEqual(["The answer"]);
    expect(transport.posted).toHaveLength(1);
    expect(progress.posted).toBe(false);
  });

  it("does nothing when the answer arrives before any note", async () => {
    const transport = new FakeTransport();
    const { editor: progress } = editor(transport);
    await progress.finish("The answer");

    expect(transport.posted).toEqual([]);
    expect(transport.edits).toEqual([]);
  });

  it("logs a failed post and keeps the answer on the normal path", async () => {
    const transport = new FakeTransport();
    transport.send = () => Promise.reject(new Error("missing access"));
    const { editor: progress, errors } = editor(transport, 0);
    progress.note("Thinking");
    await settle();

    expect(progress.posted).toBe(false);
    expect(errors[0]).toContain("progress_failed");
  });
});
