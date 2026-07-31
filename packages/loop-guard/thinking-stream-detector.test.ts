import { describe, expect, it } from "vitest";

import {
  MAX_THINKING_WINDOW_HASHES,
  THINKING_MATCHED_WINDOWS,
  THINKING_REPEAT_OCCURRENCES,
  ThinkingStreamDetector,
} from "./thinking-stream-detector.ts";

function passage(prefix = "reasoning"): string {
  return Array.from({ length: 176 }, (_, index) => `${prefix}${String(index)}`).join(" ");
}

function observeChunks(detector: ThinkingStreamDetector, chunks: readonly string[]) {
  for (const chunk of chunks) {
    const decision = detector.observe(chunk);
    if (decision !== null) return decision;
  }
  return detector.finish();
}

function characterChunks(value: string): string[] {
  return Array.from(value);
}

function irregularChunks(value: string): string[] {
  const chunks: string[] = [];
  let offset = 0;
  let width = 1;
  while (offset < value.length) {
    chunks.push(value.slice(offset, offset + width));
    offset += width;
    width = (width * 7) % 43 || 1;
  }
  return chunks;
}

describe("ThinkingStreamDetector", () => {
  it("detects three long repeated reasoning regions", () => {
    const detector = new ThinkingStreamDetector();
    const repeated = passage();
    const decision = observeChunks(detector, [`${repeated} ${repeated} ${repeated}`]);

    expect(decision).toMatchObject({
      kind: "thinking_repetition",
      matchedWindows: THINKING_MATCHED_WINDOWS,
      occurrences: THINKING_REPEAT_OCCURRENCES,
    });
  });

  it("detects repetition independently of provider chunk boundaries", () => {
    const repeated = passage("chunk");
    const input = `${repeated}\n${repeated}\n${repeated}`;

    const whole = observeChunks(new ThinkingStreamDetector(), [input]);
    const characters = observeChunks(new ThinkingStreamDetector(), characterChunks(input));
    const irregular = observeChunks(new ThinkingStreamDetector(), irregularChunks(input));

    expect(whole).not.toBeNull();
    expect(characters).toEqual(whole);
    expect(irregular).toEqual(whole);
  });

  it("normalizes case, whitespace, and composed Unicode across chunks", () => {
    const composed = Array.from({ length: 176 }, (_, index) => `Café${String(index)}`).join(" ");
    const decomposed = composed.normalize("NFD").toUpperCase().replaceAll(" ", "\n\t");
    const decision = observeChunks(
      new ThinkingStreamDetector(),
      irregularChunks(`${composed} ${decomposed} ${composed}`),
    );

    expect(decision?.kind).toBe("thinking_repetition");
  });

  it("does not trigger after only two occurrences", () => {
    const repeated = passage("twice");
    expect(observeChunks(new ThinkingStreamDetector(), [`${repeated} ${repeated}`])).toBeNull();
  });

  it("does not trigger on short repeated phrases or ordinary planning", () => {
    const planning = [
      "First inspect the repository and identify the relevant module.",
      "Then add focused tests for the behavior under review.",
      "Run formatting type checking and the package test suite.",
      "Finally summarize the evidence and any remaining limitation.",
      "First inspect the repository and identify the relevant module.",
      "Then stop because the requested review is complete.",
    ].join(" ");
    expect(observeChunks(new ThinkingStreamDetector(), [planning])).toBeNull();
  });

  it("catches a synthetic Bob-style cycle before the third cycle completes", () => {
    const detector = new ThinkingStreamDetector();
    const preface = passage("preface").split(" ").slice(0, 40).join(" ");
    const cycle = [passage("density"), passage("overlap"), passage("reconsider")].join(" ");
    const input = `${preface} ${cycle} ${cycle} ${cycle} ${cycle}`;
    const decision = observeChunks(detector, irregularChunks(input));

    expect(decision?.kind).toBe("thinking_repetition");
    if (decision?.kind !== "thinking_repetition") {
      throw new Error("Expected streamed thinking repetition");
    }
    expect(decision.tokensObserved).toBeLessThan(
      preface.split(" ").length + cycle.split(" ").length * 3,
    );
  });

  it("keeps retained state bounded on long unique streams", () => {
    const detector = new ThinkingStreamDetector();
    for (let index = 0; index < 50_000; index += 1) {
      expect(detector.observe(`unique${String(index)} `)).toBeNull();
    }

    expect(detector.retainedHashCount).toBeLessThanOrEqual(MAX_THINKING_WINDOW_HASHES);
    expect(detector.tokensObserved).toBe(50_000);
  });

  it("resets all evidence", () => {
    const detector = new ThinkingStreamDetector();
    const repeated = passage("reset");
    expect(observeChunks(detector, [`${repeated} ${repeated}`])).toBeNull();
    expect(detector.retainedHashCount).toBeGreaterThan(0);

    detector.reset();

    expect(detector.retainedHashCount).toBe(0);
    expect(detector.tokensObserved).toBe(0);
    expect(observeChunks(detector, [repeated])).toBeNull();
  });
});
