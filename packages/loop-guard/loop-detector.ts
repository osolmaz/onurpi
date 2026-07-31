import { actionFeatureSimilarity, MAX_EPISODES, type EpisodeDigest } from "./feature-encoder.ts";

export const EXACT_CYCLE_REPETITIONS = 3;
export const MAX_EXACT_CYCLE_LENGTH = 4;
export const REPEATED_ERROR_COUNT = 3;
export const CONTINUATION_CHURN_COUNT = 4;
export const CONTINUATION_SIMILARITY_THRESHOLD = 0.85;

export type LoopDecision =
  | {
      cycleLength: number;
      kind: "exact_cycle";
      repetitions: number;
    }
  | {
      count: number;
      kind: "repeated_error";
    }
  | {
      count: number;
      kind: "continuation_churn";
      similarity: number;
    }
  | {
      kind: "thinking_repetition";
      matchedWindows: number;
      occurrences: number;
      tokensObserved: number;
      windowTokens: number;
    }
  | {
      kind: "manual_nudge";
    };

function suffixRepeats(history: readonly EpisodeDigest[], cycleLength: number): boolean {
  const required = cycleLength * EXACT_CYCLE_REPETITIONS;
  if (history.length < required) return false;
  const start = history.length - required;
  if (history.slice(start).some((episode) => episode.truncated)) return false;
  for (let offset = cycleLength; offset < required; offset += 1) {
    const current = history[start + offset];
    const expected = history[start + (offset % cycleLength)];
    if (current?.exactOutcomeHash !== expected?.exactOutcomeHash) return false;
  }
  return true;
}

function exactCycleLength(history: readonly EpisodeDigest[]): number | undefined {
  const maximum = Math.min(
    MAX_EXACT_CYCLE_LENGTH,
    Math.floor(history.length / EXACT_CYCLE_REPETITIONS),
  );
  for (let cycleLength = 1; cycleLength <= maximum; cycleLength += 1) {
    if (suffixRepeats(history, cycleLength)) return cycleLength;
  }
  return undefined;
}

function repeatedError(history: readonly EpisodeDigest[]): boolean {
  const suffix = history.slice(-REPEATED_ERROR_COUNT);
  if (suffix.length !== REPEATED_ERROR_COUNT) return false;
  const fingerprint = suffix[0]?.terminalErrorFingerprint;
  return (
    fingerprint !== null &&
    fingerprint !== undefined &&
    suffix.every(
      (episode) => episode.terminalError && episode.terminalErrorFingerprint === fingerprint,
    )
  );
}

function isContinuationWindow(episodes: readonly EpisodeDigest[]): boolean {
  return (
    episodes.length === CONTINUATION_CHURN_COUNT &&
    episodes.every(
      (episode) => episode.continuationPrompt && episode.toolCalls > 0 && !episode.truncated,
    )
  );
}

function adjacentSimilarities(episodes: readonly EpisodeDigest[]): number[] {
  const similarities: number[] = [];
  for (let index = 1; index < episodes.length; index += 1) {
    similarities.push(
      actionFeatureSimilarity(
        episodes[index - 1]?.actionFeatures ?? [],
        episodes[index]?.actionFeatures ?? [],
      ),
    );
  }
  return similarities;
}

function continuationSimilarity(history: readonly EpisodeDigest[]): number | undefined {
  const suffix = history.slice(-CONTINUATION_CHURN_COUNT);
  if (!isContinuationWindow(suffix)) return undefined;
  const similarities = adjacentSimilarities(suffix);
  if (similarities.some((value) => value < CONTINUATION_SIMILARITY_THRESHOLD)) return undefined;
  return similarities.reduce((total, value) => total + value, 0) / similarities.length;
}

function detect(history: readonly EpisodeDigest[]): LoopDecision | null {
  const cycleLength = exactCycleLength(history);
  if (cycleLength !== undefined) {
    return {
      cycleLength,
      kind: "exact_cycle",
      repetitions: EXACT_CYCLE_REPETITIONS,
    };
  }
  if (repeatedError(history)) {
    return { count: REPEATED_ERROR_COUNT, kind: "repeated_error" };
  }
  const similarity = continuationSimilarity(history);
  if (similarity !== undefined) {
    return {
      count: CONTINUATION_CHURN_COUNT,
      kind: "continuation_churn",
      similarity,
    };
  }
  return null;
}

export class LoopDetector {
  private readonly history: EpisodeDigest[] = [];

  get episodeCount(): number {
    return this.history.length;
  }

  observe(episode: EpisodeDigest): LoopDecision | null {
    this.history.push(episode);
    if (this.history.length > MAX_EPISODES) this.history.shift();
    return detect(this.history);
  }

  reset(): void {
    this.history.length = 0;
  }
}
