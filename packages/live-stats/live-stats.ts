const DEFAULT_CHARS_PER_TOKEN = 4;
export const DEFAULT_SAMPLE_WINDOW_MS = 5_000;
export type EmojiSpinnerVariant = {
  name: string;
  label: string;
  intervalMs: number;
  frames: readonly string[];
};

const EMOJI_SPINNER_VARIANTS = [
  {
    name: "weather",
    label: "Weather",
    intervalMs: 100,
    frames: [
      "☀️",
      "☀️",
      "☀️",
      "🌤️",
      "⛅️",
      "🌥️",
      "☁️",
      "🌧️",
      "🌨️",
      "🌧️",
      "🌨️",
      "🌧️",
      "🌨️",
      "⛈️",
      "🌨️",
      "🌧️",
      "🌨️",
      "☁️",
      "🌥️",
      "⛅️",
      "🌤️",
      "☀️",
      "☀️",
    ],
  },
  {
    name: "moon",
    label: "Moon phases",
    intervalMs: 80,
    frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
  },
  {
    name: "clock",
    label: "Clock",
    intervalMs: 100,
    frames: ["🕛", "🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚"],
  },
  {
    name: "earth",
    label: "Rotating Earth",
    intervalMs: 180,
    frames: ["🌍", "🌎", "🌏"],
  },
  {
    name: "monkey",
    label: "Monkeys",
    intervalMs: 300,
    frames: ["🙈", "🙈", "🙉", "🙊"],
  },
  {
    name: "runner",
    label: "Runner",
    intervalMs: 140,
    frames: ["🚶", "🏃"],
  },
  {
    name: "finger-dance",
    label: "Finger dance",
    intervalMs: 160,
    frames: ["🤘", "🤟", "🖖", "✋", "🤚", "👆"],
  },
  {
    name: "speaker",
    label: "Speaker volume",
    intervalMs: 160,
    frames: ["🔈", "🔉", "🔊", "🔉"],
  },
  {
    name: "man-lifecycle",
    label: "Man lifecycle",
    intervalMs: 220,
    frames: ["🤰", "👶", "👦", "🧑", "👨", "🥸", "👴", "🪦", "👻", "✨"],
  },
  {
    name: "woman-lifecycle",
    label: "Woman lifecycle",
    intervalMs: 220,
    frames: ["🤰", "👶", "👧", "🧑", "👩", "👵", "🪦", "👻", "✨"],
  },
] as const satisfies readonly EmojiSpinnerVariant[];

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

export type WorkingMessageStyles = {
  bold: (text: string) => string;
  warning: (text: string) => string;
};

function cloneEmojiSpinnerVariant(variant: EmojiSpinnerVariant): EmojiSpinnerVariant {
  return {
    name: variant.name,
    label: variant.label,
    intervalMs: variant.intervalMs,
    frames: [...variant.frames],
  };
}

export function getEmojiSpinnerVariants(): EmojiSpinnerVariant[] {
  return EMOJI_SPINNER_VARIANTS.map(cloneEmojiSpinnerVariant);
}

export function findEmojiSpinnerVariant(name: string): EmojiSpinnerVariant | undefined {
  const normalizedName = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return getEmojiSpinnerVariants().find((variant) => variant.name === normalizedName);
}

export function pickEmojiSpinnerVariant(random: () => number = Math.random): EmojiSpinnerVariant {
  const variants = getEmojiSpinnerVariants();
  const fallback = variants[0];
  if (fallback === undefined) throw new Error("missing emoji spinner variants");
  return variants[Math.floor(random() * variants.length)] ?? fallback;
}

export class EmojiSpinnerState {
  private selected: EmojiSpinnerVariant;

  public constructor(random: () => number = Math.random) {
    this.selected = pickEmojiSpinnerVariant(random);
  }

  public get current(): EmojiSpinnerVariant {
    return cloneEmojiSpinnerVariant(this.selected);
  }

  public select(name: string): boolean {
    const spinner = findEmojiSpinnerVariant(name);
    if (spinner === undefined) return false;
    this.selected = spinner;
    return true;
  }

  public randomize(random: () => number = Math.random): void {
    this.selected = pickEmojiSpinnerVariant(random);
  }
}

export function formatStyledEmojiSpinnerFrames(
  variant: EmojiSpinnerVariant,
  styles: WorkingMessageStyles,
): string[] {
  return variant.frames.map((frame) => styles.bold(styles.warning(frame)));
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

export function formatWorkingMessage(snapshot: LiveStatsSnapshot, workingPhrase: string): string {
  return `${workingPhrase}… (${formatWorkingStats(snapshot)})`;
}

export function formatStyledWorkingMessage(
  snapshot: LiveStatsSnapshot,
  workingPhrase: string,
  styles: WorkingMessageStyles,
): string {
  return styles.bold(styles.warning(formatWorkingMessage(snapshot, workingPhrase)));
}

function formatWorkingStats(snapshot: LiveStatsSnapshot): string {
  const approximate = snapshot.outputApproximate ? "~" : "";
  const rate = snapshot.tokensPerSecond?.toFixed(1) ?? "—";
  return `${formatElapsed(snapshot.elapsedMs)} · ${approximate}${formatTokenCount(snapshot.outputTokens)} out · ${rate} tok/s`;
}

function formatCompact(value: number, suffix: string): string {
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals).replace(/\.0$/u, "")}${suffix}`;
}

function padTwo(value: number): string {
  return value.toString().padStart(2, "0");
}
