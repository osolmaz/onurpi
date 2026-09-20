import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  countOutputContentChars,
  formatElapsed,
  formatStyledSpinnerFrames,
  formatStyledWorkingMessage,
  formatTokenCount,
  formatWorkingMessage,
  LiveStatsTracker,
  WORKING_SPINNER,
} from "./live-stats.ts";

describe("LiveStatsTracker", () => {
  it("rejects invalid estimation settings", () => {
    expect(() => new LiveStatsTracker(0)).toThrow("sampleWindowMs must be positive");
    expect(() => new LiveStatsTracker(5_000, 0)).toThrow("charsPerToken must be positive");
  });

  it("starts and resets a run", () => {
    const tracker = new LiveStatsTracker();

    expect(tracker.active).toBe(false);
    expect(tracker.snapshot(10_000)).toEqual({
      elapsedMs: 0,
      outputTokens: 0,
      outputApproximate: false,
      tokensPerSecond: undefined,
    });

    tracker.start(1_000);
    expect(tracker.active).toBe(true);
    expect(tracker.snapshot(3_500)).toEqual({
      elapsedMs: 2_500,
      outputTokens: 0,
      outputApproximate: false,
      tokensPerSecond: undefined,
    });

    tracker.addDelta("1234", 4_000);
    tracker.finishMessage(0);
    tracker.reset();
    expect(tracker.active).toBe(false);
    expect(tracker.snapshot(5_000)).toMatchObject({
      outputTokens: 0,
      outputApproximate: false,
    });
  });

  it("estimates cumulative stream tokens instead of rounding every chunk", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);

    tracker.addDelta("a", 250);
    tracker.addDelta("b", 500);
    tracker.addDelta("c", 750);
    tracker.addDelta("d", 1_000);

    const snapshot = tracker.snapshot(1_000);
    expect(snapshot).toMatchObject({
      outputTokens: 1,
      outputApproximate: true,
    });
    expect(snapshot.tokensPerSecond).toBeCloseTo(1.33, 2);
  });

  it("ignores message activity outside an active run and empty deltas", () => {
    const tracker = new LiveStatsTracker();
    tracker.addDelta("ignored", 100);
    tracker.startMessage();
    tracker.finishMessage(99);
    expect(tracker.snapshot(200).outputTokens).toBe(0);

    tracker.start(0);
    tracker.addDelta("", 200);

    expect(tracker.snapshot(1_000)).toMatchObject({
      outputTokens: 0,
      outputApproximate: false,
      tokensPerSecond: undefined,
    });
  });

  it("samples estimated output over the configured rolling window", () => {
    const tracker = new LiveStatsTracker(5_000, 4);
    tracker.start(0);
    tracker.addDelta("12345678901234567890", 1_000);

    expect(tracker.snapshot(2_000).tokensPerSecond).toBe(5);
    expect(tracker.snapshot(7_000).tokensPerSecond).toBe(0);
  });

  it("keeps a stable rate denominator as old samples expire", () => {
    const tracker = new LiveStatsTracker(5_000, 1);
    tracker.start(0);
    tracker.addDelta("12345", 1_000);
    tracker.addDelta("67890", 5_900);

    expect(tracker.snapshot(6_000).tokensPerSecond).toBe(2);
    expect(tracker.snapshot(6_100).tokensPerSecond).toBe(1);
  });

  it("combines token increments recorded at the same time", () => {
    const tracker = new LiveStatsTracker(5_000, 1);
    tracker.start(0);
    tracker.addDelta("ab", 1_000);
    tracker.addDelta("cd", 1_000);

    expect(tracker.snapshot(2_000).tokensPerSecond).toBe(4);
  });

  it("reconciles completed messages with reported output usage", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);
    tracker.addDelta("abcdefgh", 1_000);
    tracker.finishMessage(12);

    expect(tracker.snapshot(2_000)).toMatchObject({
      outputTokens: 12,
      outputApproximate: false,
    });

    tracker.startMessage();
    tracker.addDelta("1234", 2_500);
    expect(tracker.snapshot(3_000)).toMatchObject({
      outputTokens: 13,
      outputApproximate: true,
    });

    tracker.finishMessage(7);
    expect(tracker.snapshot(3_000)).toMatchObject({
      outputTokens: 19,
      outputApproximate: false,
    });
  });

  it("keeps an estimate when a provider reports no output usage", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);
    tracker.addDelta("abcdefgh", 1_000);
    tracker.finishMessage(0);
    tracker.finishMessage(-1);

    expect(tracker.snapshot(2_000)).toMatchObject({
      outputTokens: 2,
      outputApproximate: true,
    });
  });

  it("estimates finalized content when a provider emits no deltas or usage", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);
    tracker.finishMessage(0, 12);
    tracker.finishMessage(0, -1);

    expect(tracker.snapshot(1_000)).toMatchObject({
      outputTokens: 3,
      outputApproximate: true,
    });
  });

  it("keeps the larger stream estimate when final content is shorter", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);
    tracker.addDelta("12345678", 500);
    tracker.finishMessage(0, 4);

    expect(tracker.snapshot(1_000).outputTokens).toBe(2);
  });

  it("can reset the current message without affecting completed usage", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(0);
    tracker.addDelta("1234", 500);
    tracker.finishMessage(10);
    tracker.addDelta("discarded", 1_000);
    tracker.startMessage();

    expect(tracker.snapshot(2_000)).toMatchObject({
      outputTokens: 10,
      outputApproximate: false,
    });
  });

  it("clamps elapsed time when the clock moves backwards", () => {
    const tracker = new LiveStatsTracker();
    tracker.start(1_000);

    expect(tracker.snapshot(500).elapsedMs).toBe(0);
  });
});

describe("countOutputContentChars", () => {
  it("counts text, thinking, and serialized tool calls", () => {
    expect(
      countOutputContentChars([
        { type: "text", text: "hello" },
        { type: "thinking", thinking: "abc" },
        { type: "toolCall", name: "read", arguments: { path: "a" } },
      ]),
    ).toBe(24);
  });
});

describe("formatElapsed", () => {
  it.each([
    [-1, "0s"],
    [59_999, "59s"],
    [60_000, "1m 00s"],
    [3_605_000, "1h 00m 05s"],
    [90_061_000, "25h 01m 01s"],
  ])("formats %i ms as %s", (elapsedMs, expected) => {
    expect(formatElapsed(elapsedMs)).toBe(expected);
  });
});

describe("formatTokenCount", () => {
  it.each([
    [-1, "0"],
    [999, "999"],
    [1_000, "1K"],
    [1_250, "1.3K"],
    [12_500, "13K"],
    [1_250_000, "1.3M"],
    [12_500_000, "13M"],
  ])("formats %i tokens as %s", (tokens, expected) => {
    expect(formatTokenCount(tokens)).toBe(expected);
  });
});

describe("working spinner", () => {
  it("uses the circle-halves frames from cli-spinners", () => {
    expect(WORKING_SPINNER).toEqual({
      name: "circle-halves",
      label: "Circle halves",
      intervalMs: 50,
      frames: ["◐", "◓", "◑", "◒"],
    });
  });

  it("keeps every frame at one terminal column with no padding", () => {
    expect(new Set(WORKING_SPINNER.frames.map((frame) => visibleWidth(frame)))).toEqual(
      new Set([1]),
    );
    expect(WORKING_SPINNER.frames.every((frame) => frame.trimEnd() === frame)).toBe(true);
  });

  it("renders every frame in bold warning color", () => {
    const styles = {
      bold: (text: string) => `<b>${text}</b>`,
      warning: (text: string) => `<warning>${text}</warning>`,
    };

    expect(formatStyledSpinnerFrames(WORKING_SPINNER.frames, styles)).toEqual([
      "<b><warning>◐</warning></b>",
      "<b><warning>◓</warning></b>",
      "<b><warning>◑</warning></b>",
      "<b><warning>◒</warning></b>",
    ]);
  });
});

describe("formatWorkingMessage", () => {
  const snapshot = {
    elapsedMs: 12_400,
    outputTokens: 438,
    outputApproximate: true,
    tokensPerSecond: 21.74,
  };

  it("shows estimated output and a sampled rate without a phrase", () => {
    expect(formatWorkingMessage(snapshot)).toBe("(12s · ~438 out · 21.7 tok/s)");
  });

  it("shows unavailable throughput before sampling begins", () => {
    expect(
      formatWorkingMessage({
        elapsedMs: 0,
        outputTokens: 0,
        outputApproximate: false,
        tokensPerSecond: undefined,
      }),
    ).toBe("(0s · 0 out · — tok/s)");
  });

  it("keeps emoji and Turkish text out of the working line", () => {
    expect(formatWorkingMessage(snapshot)).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(formatWorkingMessage(snapshot)).not.toMatch(/[ıİşŞğĞüÜöÖçÇ]/u);
  });

  it("renders the complete working line in bold warning color", () => {
    const styles = {
      bold: (text: string) => `<b>${text}</b>`,
      warning: (text: string) => `<warning>${text}</warning>`,
    };

    expect(
      formatStyledWorkingMessage(
        { elapsedMs: 1_000, outputTokens: 12, outputApproximate: false, tokensPerSecond: 4 },
        styles,
      ),
    ).toBe("<b><warning>(1s · 12 out · 4.0 tok/s)</warning></b>");
  });
});
