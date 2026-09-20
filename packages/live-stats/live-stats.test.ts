import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  countOutputContentChars,
  formatElapsed,
  formatRate,
  formatShimmeredWorkingMessage,
  formatStyledSpinnerFrames,
  formatTokenCount,
  formatWorkingMessage,
  lightenRamp,
  LiveStatsTracker,
  parseTruecolorForeground,
  SHIMMER_SWEEP_FRACTION,
  toGraphemes,
  WORKING_SPINNER,
  type ColorStyler,
  type LiveStatsSnapshot,
  type WorkingMessageStyles,
} from "./live-stats.ts";

const SNAPSHOT: LiveStatsSnapshot = {
  elapsedMs: 12_400,
  outputTokens: 438,
  outputApproximate: true,
  tokensPerSecond: 21.74,
};

/** Marker stylers, so a test can see which ramp stop colored each character. */
function rampStyles(levels = 4): WorkingMessageStyles {
  return {
    bold: (text: string) => `<b>${text}</b>`,
    ramp: Array.from(
      { length: levels },
      (_, level) =>
        (text: string): string =>
          `<${String(level)}>${text}</>`,
    ),
  };
}

function shimmerSegments(cycle: number, levels = 4): string[] {
  const styled = formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(levels), cycle);
  const body = styled.slice("<b>".length, -"</b>".length);
  const segments = body.split("</>");
  segments.pop();
  return segments;
}

/** Index of the leftmost character that carries the brightest ramp stop. */
function peakIndex(cycle: number): number {
  return shimmerSegments(cycle).findIndex((segment) => segment.startsWith("<3>"));
}

function stylerAnsi(styler: ColorStyler): string {
  return styler("").replace(/\x1b\[39m$/u, "");
}

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

describe("formatRate", () => {
  it.each([
    [0, "0.0"],
    [4, "4.0"],
    [21.74, "21.7"],
    [99.9, "99.9"],
    [99.95, "100"],
    [100, "100"],
    [123.4, "123"],
    [999.5, "1000"],
  ])("formats %s tok/s as %s", (rate, expected) => {
    expect(formatRate(rate)).toBe(expected);
  });

  it("shows an em dash before sampling begins", () => {
    expect(formatRate(undefined)).toBe("—");
  });
});

describe("working spinner", () => {
  it("uses the dots5 frames from cli-spinners", () => {
    expect(WORKING_SPINNER).toEqual({
      name: "dots5",
      label: "Dots 5",
      intervalMs: 80,
      frames: ["⠋", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"],
    });
  });

  it("keeps every frame at one terminal column with no padding", () => {
    expect(new Set(WORKING_SPINNER.frames.map((frame) => visibleWidth(frame)))).toEqual(
      new Set([1]),
    );
    expect(WORKING_SPINNER.frames.every((frame) => frame.trimEnd() === frame)).toBe(true);
  });

  it("renders every frame in bold base color", () => {
    expect(formatStyledSpinnerFrames(WORKING_SPINNER.frames, rampStyles())).toEqual(
      WORKING_SPINNER.frames.map((frame) => `<b><0>${frame}</></b>`),
    );
  });
});

describe("formatWorkingMessage", () => {
  const snapshot = {
    elapsedMs: 12_400,
    outputTokens: 438,
    outputApproximate: true,
    tokensPerSecond: 21.74,
  };

  it("labels the line as working and shows estimated output and a sampled rate", () => {
    expect(formatWorkingMessage(snapshot)).toBe("Working… (12s · ~438 out · 21.7 tok/s)");
  });

  it("shows unavailable throughput before sampling begins", () => {
    expect(
      formatWorkingMessage({
        elapsedMs: 0,
        outputTokens: 0,
        outputApproximate: false,
        tokensPerSecond: undefined,
      }),
    ).toBe("Working… (0s · 0 out · — tok/s)");
  });

  it("drops the decimal at 100 tok/s and above", () => {
    expect(formatWorkingMessage({ ...snapshot, tokensPerSecond: 123.4 })).toBe(
      "Working… (12s · ~438 out · 123 tok/s)",
    );
  });

  it("keeps emoji and Turkish text out of the working line", () => {
    expect(formatWorkingMessage(snapshot)).not.toMatch(/\p{Emoji_Presentation}/u);
    expect(formatWorkingMessage(snapshot)).not.toMatch(/[ıİşŞğĞüÜöÖçÇ]/u);
  });

  it("renders the complete working line in bold base color", () => {
    const snapshot = {
      elapsedMs: 1_000,
      outputTokens: 12,
      outputApproximate: false,
      tokensPerSecond: 4,
    };
    const expected = `<b>${toGraphemes(formatWorkingMessage(snapshot))
      .map((character) => `<0>${character}</>`)
      .join("")}</b>`;

    expect(formatShimmeredWorkingMessage(snapshot, rampStyles(1), 0)).toBe(expected);
  });
});

describe("toGraphemes", () => {
  it("keeps combined glyphs together", () => {
    expect(toGraphemes("a\u0301b")).toEqual(["a\u0301", "b"]);
    expect(toGraphemes("👍🏽!")).toEqual(["👍🏽", "!"]);
  });
});

describe("parseTruecolorForeground", () => {
  it("reads a truecolor foreground escape", () => {
    expect(parseTruecolorForeground("\x1b[38;2;250;179;135m")).toEqual({
      red: 250,
      green: 179,
      blue: 135,
    });
  });

  it("rejects other escape forms", () => {
    expect(parseTruecolorForeground("\x1b[38;5;216m")).toBeUndefined();
    expect(parseTruecolorForeground("\x1b[38;2;250;179;135m\x1b[39m")).toBeUndefined();
    expect(parseTruecolorForeground("")).toBeUndefined();
  });

  it("rejects an out-of-range channel", () => {
    expect(parseTruecolorForeground("\x1b[38;2;250;179;999m")).toBeUndefined();
  });
});

describe("lightenRamp", () => {
  const base = { red: 250, green: 179, blue: 135 };

  it("blends from the base color to a lighter tint", () => {
    const ramp = lightenRamp(base, 4);
    const ansi = ramp.map((styler) => stylerAnsi(styler));

    expect(ansi).toHaveLength(4);
    expect(ansi[0]).toBe("\x1b[38;2;250;179;135m");
    expect(ansi[3]).toBe("\x1b[38;2;253;217;195m");
  });

  it("keeps the base color when only one stop is requested", () => {
    expect(lightenRamp(base, 1).map((styler) => stylerAnsi(styler))).toEqual([
      "\x1b[38;2;250;179;135m",
    ]);
  });

  it("lightens every channel step by step", () => {
    const channels = lightenRamp(base, 4).map((styler) =>
      parseTruecolorForeground(stylerAnsi(styler)),
    );

    expect(channels.map((rgb) => rgb?.red)).toEqual([250, 251, 252, 253]);
    expect(channels.map((rgb) => rgb?.green)).toEqual([179, 192, 204, 217]);
    expect(channels.map((rgb) => rgb?.blue)).toEqual([135, 155, 175, 195]);
  });

  it("rejects an empty ramp", () => {
    expect(() => lightenRamp(base, 0)).toThrow("stops must be at least 1");
  });
});

describe("formatShimmeredWorkingMessage", () => {
  const text = formatWorkingMessage(SNAPSHOT);
  const characters = toGraphemes(text);
  const middle = Math.floor(characters.length / 2);

  it("keeps the visible text unchanged", () => {
    const restored = shimmerSegments(0.4)
      .map((segment) => segment.slice(3))
      .join("");

    expect(restored).toBe(text);
  });

  it("starts free of shimmer", () => {
    expect(shimmerSegments(0).every((segment) => segment.startsWith("<0>"))).toBe(true);
  });

  it("rests in the base color after the sweep finishes", () => {
    for (const cycle of [SHIMMER_SWEEP_FRACTION, 0.9, 0.999]) {
      expect(shimmerSegments(cycle).every((segment) => segment.startsWith("<0>"))).toBe(true);
    }
  });

  it("enters from the right edge", () => {
    expect(peakIndex(0.25)).toBeGreaterThan(middle);
  });

  it("crosses the line from right to left", () => {
    expect(peakIndex(0.25)).toBeGreaterThan(peakIndex(0.375));
    expect(peakIndex(0.375)).toBeGreaterThan(peakIndex(0.5));
  });

  it("puts the brightest stop near the middle at the midpoint of the sweep", () => {
    expect(Math.abs(peakIndex(0.375) - middle)).toBeLessThanOrEqual(1);
  });

  it("leaves the rest of the line in the base color", () => {
    const segments = shimmerSegments(0.375);

    expect(segments[0]).toBe(`<0>${characters[0] ?? ""}`);
    expect(segments.at(-1)).toBe(`<0>${characters.at(-1) ?? ""}`);
  });

  it("uses only the base stop when the ramp has one color", () => {
    expect(shimmerSegments(0.375, 1).every((segment) => segment.startsWith("<0>"))).toBe(true);
  });

  it("normalizes the cycle and treats a bad cycle as zero", () => {
    expect(formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), 1.4)).toBe(
      formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), 0.4),
    );
    expect(formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), -0.6)).toBe(
      formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), 0.4),
    );
    expect(formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), Number.NaN)).toBe(
      formatShimmeredWorkingMessage(SNAPSHOT, rampStyles(), 0),
    );
  });

  it("keeps the rendered width equal to the plain line", () => {
    const styles: WorkingMessageStyles = {
      bold: (value: string) => `\x1b[1m${value}\x1b[22m`,
      ramp: lightenRamp({ red: 250, green: 179, blue: 135 }, 4),
    };

    expect(visibleWidth(formatShimmeredWorkingMessage(SNAPSHOT, styles, 0.3))).toBe(
      visibleWidth(text),
    );
  });

  it("rejects a missing color ramp", () => {
    expect(() =>
      formatShimmeredWorkingMessage(SNAPSHOT, { bold: (value) => value, ramp: [] }, 0),
    ).toThrow("missing working message color ramp");
  });
});
