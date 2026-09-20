const DEFAULT_CHARS_PER_TOKEN = 4;
export const DEFAULT_SAMPLE_WINDOW_MS = 5_000;

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

export type WorkingMessageSegment = {
  text: string;
  /** The label is bold. The statistics stay in the normal weight, parentheses included. */
  bold: boolean;
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

/**
 * Builds color stylers from a base color to a lighter highlight. The ramp keeps the theme's hue and
 * stops short of white, so the highlight reads as a lighter tint instead of a white sweep.
 */
export function lightenRamp(base: Rgb, stops: number, maxBlend = 0.5): ColorStyler[] {
  return lightenStops(base, stops, maxBlend).map((color) =>
    styler(`\x1b[38;2;${String(color.red)};${String(color.green)};${String(color.blue)}m`),
  );
}

/**
 * Builds ramp stylers that emit 256-color escapes. The base stop keeps the theme's own palette
 * index, so the line starts in the exact color the theme names. Only the lighter stops are mapped
 * back to a palette index.
 */
export function lightenRamp256(index: number, stops: number, maxBlend = 0.5): ColorStyler[] {
  return lightenStops(ansi256ToRgb(index), stops, maxBlend).map((color, position) =>
    styler(`\x1b[38;5;${String(position === 0 ? index : rgbToAnsi256(color))}m`),
  );
}

/** Builds the ramp stops from a base color to a lighter tint of it. */
export function lightenStops(base: Rgb, stops: number, maxBlend = 0.5): Rgb[] {
  if (stops < 1) throw new RangeError("stops must be at least 1");
  return Array.from({ length: stops }, (_, index) => {
    const blend = stops === 1 ? 0 : (index / (stops - 1)) * maxBlend;
    return {
      red: lightenChannel(base.red, blend),
      green: lightenChannel(base.green, blend),
      blue: lightenChannel(base.blue, blend),
    };
  });
}

function styler(ansi: string): ColorStyler {
  return (text: string): string => `${ansi}${text}\x1b[39m`;
}

/** Reads the palette index from a 256-color foreground escape such as "\x1b[38;5;216m". */
export function parseAnsi256Foreground(ansi: string): number | undefined {
  const match = /^\x1b\[38;5;(\d{1,3})m$/u.exec(ansi);
  if (match === null) return undefined;
  const index = Number(match[1]);
  return index > 255 ? undefined : index;
}

// Standard xterm values for the first 16 palette indices. A terminal may remap these colors, so
// rgbToAnsi256 never chooses them.
const ANSI_16_RGB: readonly Rgb[] = [
  { red: 0, green: 0, blue: 0 },
  { red: 128, green: 0, blue: 0 },
  { red: 0, green: 128, blue: 0 },
  { red: 128, green: 128, blue: 0 },
  { red: 0, green: 0, blue: 128 },
  { red: 128, green: 0, blue: 128 },
  { red: 0, green: 128, blue: 128 },
  { red: 192, green: 192, blue: 192 },
  { red: 128, green: 128, blue: 128 },
  { red: 255, green: 0, blue: 0 },
  { red: 0, green: 255, blue: 0 },
  { red: 255, green: 255, blue: 0 },
  { red: 0, green: 0, blue: 255 },
  { red: 255, green: 0, blue: 255 },
  { red: 0, green: 255, blue: 255 },
  { red: 255, green: 255, blue: 255 },
];

const CUBE_CHANNELS: readonly number[] = [0, 95, 135, 175, 215, 255];

/** The xterm 256-color palette, built once from the standard colors, the cube, and the grays. */
const PALETTE: readonly Rgb[] = buildPalette();

function buildPalette(): Rgb[] {
  const palette: Rgb[] = [...ANSI_16_RGB];
  for (let index = 16; index <= 231; index += 1) {
    const cube = index - 16;
    palette.push({
      red: cubeChannel(Math.floor(cube / 36)),
      green: cubeChannel(Math.floor((cube % 36) / 6)),
      blue: cubeChannel(cube % 6),
    });
  }
  for (let index = 232; index <= 255; index += 1) {
    const level = 8 + (index - 232) * 10;
    palette.push({ red: level, green: level, blue: level });
  }
  return palette;
}

function cubeChannel(position: number): number {
  return CUBE_CHANNELS[position] ?? 0;
}

/** Converts an xterm 256-color palette index to RGB. */
export function ansi256ToRgb(index: number): Rgb {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new RangeError("palette index must be an integer from 0 to 255");
  }
  return PALETTE[index] ?? { red: 0, green: 0, blue: 0 };
}

/** Finds the palette index closest to a color, among the cube and the grayscale ramp. */
export function rgbToAnsi256(color: Rgb): number {
  let closest = 16;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 16; index <= 255; index += 1) {
    const distance = colorDistance(color, ansi256ToRgb(index));
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = index;
    }
  }
  return closest;
}

function colorDistance(left: Rgb, right: Rgb): number {
  const red = left.red - right.red;
  const green = left.green - right.green;
  const blue = left.blue - right.blue;
  // The weights follow human sensitivity, the same way Pi maps a hex color to a palette index.
  return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
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
  return workingMessageSegments(snapshot)
    .map((segment) => segment.text)
    .join("");
}

/** The working line in order: the bold label, then the statistics in plain parentheses. */
export function workingMessageSegments(snapshot: LiveStatsSnapshot): WorkingMessageSegment[] {
  return [
    { text: WORKING_LABEL, bold: true },
    { text: ` (${formatWorkingStats(snapshot)})`, bold: false },
  ];
}

/** Share of the line covered by the traveling shimmer band. */
const SHIMMER_BAND_FRACTION = 0.35;

/** Share of each shimmer cycle spent crossing the line. The rest is a rest in the base color. */
export const SHIMMER_SWEEP_FRACTION = 0.75;

/**
 * Colors the working line character by character. A band of lighter stops enters from the right
 * edge, travels left across the line, and leaves through the left edge, so the line starts and ends
 * each sweep in the base color. `cycle` is the progress through one full cycle: the band crosses
 * during the first SHIMMER_SWEEP_FRACTION of the cycle, and the line rests in the base color for the
 * remainder. Only the label is bold, so the statistics keep the normal weight.
 */
export function formatShimmeredWorkingMessage(
  snapshot: LiveStatsSnapshot,
  styles: WorkingMessageStyles,
  cycle: number,
): string {
  const segments = workingMessageSegments(snapshot);
  const base = baseColor(styles);
  const colors = shimmerColors(
    segments.flatMap((segment) => toGraphemes(segment.text)).length,
    styles,
    cycle,
  );

  let offset = 0;
  let output = "";
  for (const segment of segments) {
    const characters = toGraphemes(segment.text);
    const colored = characters
      .map((character, position) => (colors[offset + position] ?? base)(character))
      .join("");
    offset += characters.length;
    output += segment.bold ? styles.bold(colored) : colored;
  }
  return output;
}

/** Picks the color styler of every character of the line at one point in the shimmer cycle. */
function shimmerColors(length: number, styles: WorkingMessageStyles, cycle: number): ColorStyler[] {
  const base = baseColor(styles);
  const progress = normalizePhase(cycle);
  if (progress >= SHIMMER_SWEEP_FRACTION) return Array.from({ length }, () => base);

  const peak = styles.ramp.length - 1;
  const halfBand = Math.max(1, (length * SHIMMER_BAND_FRACTION) / 2);
  const traveled = (progress / SHIMMER_SWEEP_FRACTION) * (length + 2 * halfBand);
  const center = length + halfBand - traveled;
  return Array.from({ length }, (_, index) => {
    const distance = Math.abs(index + 0.5 - center);
    const intensity = Math.max(0, 1 - distance / halfBand);
    return styles.ramp[Math.round(intensity * peak)] ?? base;
  });
}

function normalizePhase(cycle: number): number {
  if (!Number.isFinite(cycle)) return 0;
  return ((cycle % 1) + 1) % 1;
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
