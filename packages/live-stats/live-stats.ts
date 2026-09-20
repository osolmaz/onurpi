const DEFAULT_CHARS_PER_TOKEN = 4;
export const DEFAULT_SAMPLE_WINDOW_MS = 5_000;

export type WorkingSpinner = {
  name: string;
  label: string;
  intervalMs: number;
  frames: readonly string[];
};

// Frames are the dots5 spinner from sindresorhus/cli-spinners, which the referenced CodePen
// renders. Every frame is one terminal column wide, so the working line never shifts.
export const WORKING_SPINNER: WorkingSpinner = {
  name: "dots5",
  label: "Dots 5",
  intervalMs: 80,
  frames: ["⠋", "⠙", "⠚", "⠒", "⠂", "⠂", "⠒", "⠲", "⠴", "⠦", "⠖", "⠒", "⠐", "⠐", "⠒", "⠓", "⠋"],
};

export const WORKING_LABEL = "Working";

type TokenSample = {
  atMs: number;
  tokens: number;
};

export type LiveStatsSnapshot = {
  elapsedMs: number;
  outputTokens: number;
  outputApproximate: boolean;
  tokensPerSecond: number | undefined;
};

export type ColorStyler = (text: string) => string;

export type WorkingMessageStyles = {
  bold: (text: string) => string;
  /** Color stylers ordered from the base color to the brightest shimmer highlight. */
  ramp: readonly ColorStyler[];
};

export type Rgb = { red: number; green: number; blue: number };

const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/** Splits text into user-perceived characters, so a styler never breaks a combined glyph. */
export function toGraphemes(text: string): string[] {
  return [...GRAPHEME_SEGMENTER.segment(text)].map((entry) => entry.segment);
}

/** Reads the RGB triple from a truecolor foreground escape such as "\x1b[38;2;250;179;135m". */
export function parseTruecolorForeground(ansi: string): Rgb | undefined {
  const match = /^\x1b\[38;2;(\d{1,3});(\d{1,3});(\d{1,3})m$/u.exec(ansi);
  if (match === null) return undefined;
  const channels = match.slice(1).map(Number);
  if (channels.some((channel) => channel > 255)) return undefined;
  const [red, green, blue] = channels;
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return { red, green, blue };
}

/** Builds color stylers from a base color to a lighter highlight, keeping the theme's hue. */
export function lightenRamp(base: Rgb, stops: number, maxBlend = 0.9): ColorStyler[] {
  if (stops < 1) throw new RangeError("stops must be at least 1");
  return Array.from({ length: stops }, (_, index) => {
    const blend = stops === 1 ? 0 : (index / (stops - 1)) * maxBlend;
    const red = lightenChannel(base.red, blend);
    const green = lightenChannel(base.green, blend);
    const blue = lightenChannel(base.blue, blend);
    const ansi = `\x1b[38;2;${String(red)};${String(green)};${String(blue)}m`;
    return (text: string): string => `${ansi}${text}\x1b[39m`;
  });
}

function lightenChannel(channel: number, blend: number): number {
  return Math.round(channel + (255 - channel) * blend);
}

function baseColor(styles: WorkingMessageStyles): ColorStyler {
  const base = styles.ramp[0];
  if (base === undefined) throw new Error("missing working message color ramp");
  return base;
}

export function formatStyledSpinnerFrames(
  frames: readonly string[],
  styles: WorkingMessageStyles,
): string[] {
  const color = baseColor(styles);
  return frames.map((frame) => styles.bold(color(frame)));
}

type OutputContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; name: string; arguments: Record<string, unknown> };

export function countOutputContentChars(content: readonly OutputContent[]): number {
  let chars = 0;
  for (const block of content) {
    if (block.type === "text") chars += block.text.length;
    if (block.type === "thinking") chars += block.thinking.length;
    if (block.type === "toolCall") {
      chars += block.name.length + JSON.stringify(block.arguments).length;
    }
  }
  return chars;
}

export class LiveStatsTracker {
  private startedAtMs: number | undefined;
  private completedOutputTokens = 0;
  private completedOutputApproximate = false;
  private currentMessageChars = 0;
  private currentMessageEstimatedTokens = 0;
  private firstOutputAtMs: number | undefined;
  private samples: TokenSample[] = [];

  public constructor(
    private readonly sampleWindowMs = DEFAULT_SAMPLE_WINDOW_MS,
    private readonly charsPerToken = DEFAULT_CHARS_PER_TOKEN,
  ) {
    if (sampleWindowMs <= 0) throw new RangeError("sampleWindowMs must be positive");
    if (charsPerToken <= 0) throw new RangeError("charsPerToken must be positive");
  }

  public get active(): boolean {
    return this.startedAtMs !== undefined;
  }

  public start(nowMs: number): void {
    this.startedAtMs = nowMs;
    this.completedOutputTokens = 0;
    this.completedOutputApproximate = false;
    this.resetCurrentMessage();
    this.firstOutputAtMs = undefined;
    this.samples = [];
  }

  public startMessage(): void {
    if (!this.active) return;
    this.resetCurrentMessage();
  }

  public addDelta(delta: string, nowMs: number): void {
    if (!this.active || delta.length === 0) return;

    this.currentMessageChars += delta.length;
    const nextEstimate = Math.ceil(this.currentMessageChars / this.charsPerToken);
    const increment = nextEstimate - this.currentMessageEstimatedTokens;
    this.currentMessageEstimatedTokens = nextEstimate;

    if (increment > 0) this.addSample(nowMs, increment);
  }

  public finishMessage(reportedOutputTokens: number, finalContentChars = 0): void {
    if (!this.active) return;

    if (reportedOutputTokens > 0) {
      this.completedOutputTokens += reportedOutputTokens;
    } else {
      const finalContentEstimate = Math.ceil(Math.max(0, finalContentChars) / this.charsPerToken);
      const fallbackEstimate = Math.max(this.currentMessageEstimatedTokens, finalContentEstimate);
      this.completedOutputTokens += fallbackEstimate;
      this.completedOutputApproximate ||= fallbackEstimate > 0;
    }
    this.resetCurrentMessage();
  }

  public snapshot(nowMs: number): LiveStatsSnapshot {
    const elapsedMs = this.startedAtMs === undefined ? 0 : Math.max(0, nowMs - this.startedAtMs);
    const outputTokens = this.completedOutputTokens + this.currentMessageEstimatedTokens;

    return {
      elapsedMs,
      outputTokens,
      outputApproximate: this.completedOutputApproximate || this.currentMessageEstimatedTokens > 0,
      tokensPerSecond: this.recentRate(nowMs),
    };
  }

  public reset(): void {
    this.startedAtMs = undefined;
    this.completedOutputTokens = 0;
    this.completedOutputApproximate = false;
    this.resetCurrentMessage();
    this.firstOutputAtMs = undefined;
    this.samples = [];
  }

  private addSample(nowMs: number, tokens: number): void {
    this.firstOutputAtMs ??= nowMs;
    const last = this.samples.at(-1);
    if (last?.atMs === nowMs) {
      last.tokens += tokens;
    } else {
      this.samples.push({ atMs: nowMs, tokens });
    }

    const cutoff = nowMs - this.sampleWindowMs;
    this.samples = this.samples.filter((sample) => sample.atMs >= cutoff);
  }

  private recentRate(nowMs: number): number | undefined {
    if (this.firstOutputAtMs === undefined) return undefined;

    const durationMs = Math.min(nowMs - this.firstOutputAtMs, this.sampleWindowMs);
    if (durationMs <= 0) return undefined;

    const cutoff = nowMs - this.sampleWindowMs;
    const recentTokens = this.samples.reduce(
      (total, sample) => total + (sample.atMs >= cutoff ? sample.tokens : 0),
      0,
    );
    return recentTokens / (durationMs / 1_000);
  }

  private resetCurrentMessage(): void {
    this.currentMessageChars = 0;
    this.currentMessageEstimatedTokens = 0;
  }
}

export function formatElapsed(elapsedMs: number): string {
  const elapsedSeconds = Math.floor(Math.max(0, elapsedMs) / 1_000);
  const seconds = elapsedSeconds % 60;
  const minutes = Math.floor(elapsedSeconds / 60) % 60;
  const hours = Math.floor(elapsedSeconds / 3_600);

  if (hours > 0) return `${String(hours)}h ${padTwo(minutes)}m ${padTwo(seconds)}s`;
  if (minutes > 0) return `${String(minutes)}m ${padTwo(seconds)}s`;
  return `${String(seconds)}s`;
}

export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, tokens);
  if (value < 1_000) return Math.round(value).toString();
  if (value < 1_000_000) return formatCompact(value / 1_000, "K");
  return formatCompact(value / 1_000_000, "M");
}

// One decimal below 100 tok/s, a whole number at 100 tok/s and above. The comparison uses the
// rounded value, so 99.96 prints as 100 instead of 100.0.
export function formatRate(rate: number | undefined): string {
  if (rate === undefined) return "—";
  const oneDecimal = Number(rate.toFixed(1));
  return oneDecimal < 100 ? oneDecimal.toFixed(1) : String(Math.round(oneDecimal));
}

export function formatWorkingMessage(snapshot: LiveStatsSnapshot): string {
  return `${WORKING_LABEL}… (${formatWorkingStats(snapshot)})`;
}

/** Share of the line covered by the traveling shimmer band. */
const SHIMMER_BAND_FRACTION = 0.35;

/**
 * Colors the working line character by character. A band of lighter stops travels through the text
 * as `phase` advances. A phase of 0 places the band center at the start of the line, and the phase
 * wraps, so the band leaves one edge and returns through the other.
 */
export function formatShimmeredWorkingMessage(
  snapshot: LiveStatsSnapshot,
  styles: WorkingMessageStyles,
  phase: number,
): string {
  const text = formatWorkingMessage(snapshot);
  const characters = toGraphemes(text);
  const length = characters.length;
  const base = baseColor(styles);
  if (length === 0) return styles.bold("");

  const peak = styles.ramp.length - 1;
  const center = normalizePhase(phase) * length;
  const halfBand = Math.max(1, (length * SHIMMER_BAND_FRACTION) / 2);

  let output = "";
  for (const [index, character] of characters.entries()) {
    const distance = circularDistance(index + 0.5, center, length);
    const intensity = Math.max(0, 1 - distance / halfBand);
    const styler = styles.ramp[Math.round(intensity * peak)] ?? base;
    output += styler(character);
  }
  return styles.bold(output);
}

function normalizePhase(phase: number): number {
  if (!Number.isFinite(phase)) return 0;
  return ((phase % 1) + 1) % 1;
}

function circularDistance(left: number, right: number, length: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, length - direct);
}

function formatWorkingStats(snapshot: LiveStatsSnapshot): string {
  const approximate = snapshot.outputApproximate ? "~" : "";
  const rate = formatRate(snapshot.tokensPerSecond);
  return `${formatElapsed(snapshot.elapsedMs)} · ${approximate}${formatTokenCount(snapshot.outputTokens)} out · ${rate} tok/s`;
}

function formatCompact(value: number, suffix: string): string {
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals).replace(/\.0$/u, "")}${suffix}`;
}

function padTwo(value: number): string {
  return value.toString().padStart(2, "0");
}
