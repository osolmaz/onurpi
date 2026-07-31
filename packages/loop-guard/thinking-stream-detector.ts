import { createHash } from "node:crypto";

import type { LoopDecision } from "./loop-detector.ts";

export const THINKING_WINDOW_TOKENS = 96;
export const THINKING_WINDOW_SAMPLE_RATE = 8;
export const THINKING_REPEAT_OCCURRENCES = 3;
export const THINKING_MATCHED_WINDOWS = 3;
export const MAX_THINKING_WINDOW_HASHES = 2_048;
const MAX_PENDING_TOKEN_CHARACTERS = 128;

const TOKEN_CHARACTER_PATTERN = /^[\p{L}\p{M}\p{N}_]$/u;

type WindowOccurrence = {
  evidenced: boolean;
  positions: number[];
};

function thinkingDecision(tokensObserved: number): LoopDecision {
  return {
    kind: "thinking_repetition",
    matchedWindows: THINKING_MATCHED_WINDOWS,
    occurrences: THINKING_REPEAT_OCCURRENCES,
    tokensObserved,
    windowTokens: THINKING_WINDOW_TOKENS,
  };
}

export class ThinkingStreamDetector {
  private detected = false;
  private matchedWindows = 0;
  private pendingToken = "";
  private readonly retainedHashes = new Map<string, WindowOccurrence>();
  private tokenCount = 0;
  private readonly tokenWindow: string[] = [];

  get retainedHashCount(): number {
    return this.retainedHashes.size;
  }

  get tokensObserved(): number {
    return this.tokenCount;
  }

  observe(delta: string): LoopDecision | null {
    if (this.detected || delta.length === 0) return null;
    for (const character of delta) {
      if (TOKEN_CHARACTER_PATTERN.test(character)) {
        this.pendingToken += character;
        if (this.pendingToken.length >= MAX_PENDING_TOKEN_CHARACTERS) {
          const decision = this.flushPendingToken();
          if (decision !== null) return decision;
        }
        continue;
      }
      const decision = this.flushPendingToken();
      if (decision !== null) return decision;
    }
    return null;
  }

  finish(): LoopDecision | null {
    if (this.detected) return null;
    return this.flushPendingToken();
  }

  reset(): void {
    this.detected = false;
    this.matchedWindows = 0;
    this.pendingToken = "";
    this.retainedHashes.clear();
    this.tokenCount = 0;
    this.tokenWindow.length = 0;
  }

  private flushPendingToken(): LoopDecision | null {
    if (this.pendingToken.length === 0) return null;
    const token = this.pendingToken.normalize("NFKC").toLowerCase();
    this.pendingToken = "";
    if (token.length === 0) return null;
    return this.accountToken(token);
  }

  private accountToken(token: string): LoopDecision | null {
    this.tokenCount += 1;
    this.tokenWindow.push(token);
    if (this.tokenWindow.length > THINKING_WINDOW_TOKENS) this.tokenWindow.shift();
    const digest = this.sampledWindowDigest();
    return digest === undefined ? null : this.accountDigest(digest);
  }

  private sampledWindowDigest(): string | undefined {
    if (this.tokenWindow.length < THINKING_WINDOW_TOKENS) return undefined;
    const digest = createHash("sha256").update(this.tokenWindow.join("\u0000")).digest("hex");
    const sample = Number.parseInt(digest.slice(0, 8), 16);
    return sample % THINKING_WINDOW_SAMPLE_RATE === 0 ? digest : undefined;
  }

  private accountDigest(digest: string): LoopDecision | null {
    const occurrence = this.retainedHashes.get(digest);
    if (occurrence === undefined) {
      this.retainNewHash(digest);
      return null;
    }
    if (occurrence.evidenced) return null;
    const previousPosition = occurrence.positions.at(-1);
    if (
      previousPosition === undefined ||
      this.tokenCount - previousPosition < THINKING_WINDOW_TOKENS
    ) {
      return null;
    }
    occurrence.positions.push(this.tokenCount);
    if (occurrence.positions.length < THINKING_REPEAT_OCCURRENCES) return null;

    occurrence.evidenced = true;
    this.matchedWindows += 1;
    if (this.matchedWindows < THINKING_MATCHED_WINDOWS) return null;
    this.detected = true;
    return thinkingDecision(this.tokenCount);
  }

  private retainNewHash(digest: string): void {
    if (this.retainedHashes.size >= MAX_THINKING_WINDOW_HASHES) {
      const oldest = this.retainedHashes.keys().next().value;
      if (typeof oldest === "string") this.retainedHashes.delete(oldest);
    }
    this.retainedHashes.set(digest, { evidenced: false, positions: [this.tokenCount] });
  }
}
