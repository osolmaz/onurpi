const DEFAULT_CHARS_PER_TOKEN = 4;
export const DEFAULT_SAMPLE_WINDOW_MS = 5_000;

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

export class LiveStatsTracker {
  private startedAtMs: number | undefined;
  private completedOutputTokens = 0;
  private completedOutputApproximate = false;
  private currentMessageChars = 0;
  private currentMessageEstimatedTokens = 0;
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

  public finishMessage(reportedOutputTokens: number): void {
    if (!this.active) return;

    if (reportedOutputTokens > 0) {
      this.completedOutputTokens += reportedOutputTokens;
    } else {
      this.completedOutputTokens += this.currentMessageEstimatedTokens;
      this.completedOutputApproximate ||= this.currentMessageEstimatedTokens > 0;
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
    this.samples = [];
  }

  private addSample(nowMs: number, tokens: number): void {
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
    const cutoff = nowMs - this.sampleWindowMs;
    const recentSamples = this.samples.filter((sample) => sample.atMs >= cutoff);
    const oldestSample = recentSamples[0];
    if (oldestSample === undefined) return this.samples.length === 0 ? undefined : 0;

    const durationMs = Math.min(nowMs - oldestSample.atMs, this.sampleWindowMs);
    if (durationMs <= 0) return undefined;

    const recentTokens = recentSamples.reduce((total, sample) => total + sample.tokens, 0);
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

export function formatWorkingMessage(snapshot: LiveStatsSnapshot): string {
  const approximate = snapshot.outputApproximate ? "~" : "";
  const rate = snapshot.tokensPerSecond?.toFixed(1) ?? "—";
  return `Working (${formatElapsed(snapshot.elapsedMs)} · ${approximate}${formatTokenCount(snapshot.outputTokens)} out · ${rate} tok/s)`;
}

function formatCompact(value: number, suffix: string): string {
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals).replace(/\.0$/u, "")}${suffix}`;
}

function padTwo(value: number): string {
  return value.toString().padStart(2, "0");
}
