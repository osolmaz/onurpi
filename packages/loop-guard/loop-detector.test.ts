import { describe, expect, it } from "vitest";

import { MAX_EPISODES, type EpisodeDigest } from "./feature-encoder.ts";
import {
  CONTINUATION_CHURN_COUNT,
  EPISODE_CHECKPOINT,
  LoopDetector,
  TURN_CHECKPOINT,
  turnCheckpoint,
} from "./loop-detector.ts";

function episode(
  hash: string,
  options: Partial<Omit<EpisodeDigest, "exactOutcomeHash">> = {},
): EpisodeDigest {
  return {
    actionFeatures: [1, 2, 3, 4],
    continuationPrompt: false,
    exactOutcomeHash: `v1:${hash}`,
    terminalError: false,
    terminalErrorFingerprint: null,
    toolCalls: 1,
    truncated: false,
    turns: 1,
    ...options,
  };
}

describe("LoopDetector", () => {
  it("detects exact cycles of length one through four after three repetitions", () => {
    for (let cycleLength = 1; cycleLength <= 4; cycleLength += 1) {
      const detector = new LoopDetector();
      let decision = null;
      for (let repetition = 0; repetition < 3; repetition += 1) {
        for (let index = 0; index < cycleLength; index += 1) {
          decision = detector.observe(episode(`cycle-${String(index)}`));
        }
      }
      expect(decision).toEqual({ cycleLength, kind: "exact_cycle", repetitions: 3 });
    }
  });

  it("does not call a changing sequence an exact cycle", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < 7; index += 1) {
      expect(detector.observe(episode(`unique-${String(index)}`))).toBeNull();
    }
  });

  it("does not compare truncated outcomes as exact cycles", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < 3; index += 1) {
      expect(detector.observe(episode("same", { truncated: true }))).toBeNull();
    }
  });

  it("detects the same normalized terminal error three times", () => {
    const detector = new LoopDetector();
    let decision = null;
    for (let index = 0; index < 3; index += 1) {
      decision = detector.observe(
        episode(`error-${String(index)}`, {
          terminalError: true,
          terminalErrorFingerprint: "v1:same-error",
        }),
      );
    }
    expect(decision).toEqual({ count: 3, kind: "repeated_error" });
  });

  it("requires matching error fingerprints", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < 3; index += 1) {
      expect(
        detector.observe(
          episode(`error-${String(index)}`, {
            terminalError: true,
            terminalErrorFingerprint: `v1:error-${String(index)}`,
          }),
        ),
      ).toBeNull();
    }
  });

  it("detects continuation-led action churn", () => {
    const detector = new LoopDetector();
    let decision = null;
    for (let index = 0; index < CONTINUATION_CHURN_COUNT; index += 1) {
      decision = detector.observe(
        episode(`variant-${String(index)}`, {
          actionFeatures:
            index % 2 === 0 ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
          continuationPrompt: true,
        }),
      );
    }
    expect(decision?.kind).toBe("continuation_churn");
    if (decision?.kind === "continuation_churn") {
      expect(decision.similarity).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("does not trigger fuzzy matching for truncated episodes", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < CONTINUATION_CHURN_COUNT; index += 1) {
      expect(
        detector.observe(
          episode(`truncated-${String(index)}`, {
            continuationPrompt: true,
            truncated: true,
          }),
        ),
      ).toBeNull();
    }
  });

  it("does not trigger fuzzy matching without continuation prompts", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < CONTINUATION_CHURN_COUNT; index += 1) {
      expect(detector.observe(episode(`variant-${String(index)}`))).toBeNull();
    }
  });

  it("does not trigger continuation matching without tool actions", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < CONTINUATION_CHURN_COUNT; index += 1) {
      expect(
        detector.observe(
          episode(`variant-${String(index)}`, {
            actionFeatures: [],
            continuationPrompt: true,
            toolCalls: 0,
          }),
        ),
      ).toBeNull();
    }
  });

  it("uses a bounded hard checkpoint", () => {
    const detector = new LoopDetector();
    let decision = null;
    for (let index = 0; index < EPISODE_CHECKPOINT; index += 1) {
      decision = detector.observe(episode(`checkpoint-${String(index)}`));
    }
    expect(decision).toEqual({ count: EPISODE_CHECKPOINT, kind: "episode_checkpoint" });
  });

  it("keeps only the bounded history during long sessions", () => {
    const detector = new LoopDetector();
    for (let index = 0; index < 4_228; index += 1) {
      detector.observe(episode(`long-${String(index)}`));
    }
    expect(detector.episodeCount).toBe(MAX_EPISODES);
    detector.reset();
    expect(detector.episodeCount).toBe(0);
  });
});

describe("turnCheckpoint", () => {
  it("fires at bounded multiples of the turn checkpoint", () => {
    expect(turnCheckpoint(TURN_CHECKPOINT - 1)).toBeNull();
    expect(turnCheckpoint(TURN_CHECKPOINT)).toEqual({
      count: TURN_CHECKPOINT,
      kind: "turn_checkpoint",
    });
    expect(turnCheckpoint(TURN_CHECKPOINT * 2)).toEqual({
      count: TURN_CHECKPOINT * 2,
      kind: "turn_checkpoint",
    });
  });
});
