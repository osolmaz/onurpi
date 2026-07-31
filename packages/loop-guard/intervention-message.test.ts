import { describe, expect, it } from "vitest";

import { decisionLabel, interventionContent } from "./intervention-message.ts";
import type { LoopDecision } from "./loop-detector.ts";

const decisions: LoopDecision[] = [
  { cycleLength: 2, kind: "exact_cycle", repetitions: 3 },
  { count: 3, kind: "repeated_error" },
  { count: 4, kind: "continuation_churn", similarity: 0.912 },
  {
    kind: "thinking_repetition",
    matchedWindows: 3,
    occurrences: 3,
    tokensObserved: 9_234,
    windowTokens: 96,
  },
  { kind: "manual_nudge" },
];

describe("interventionContent", () => {
  it.each(decisions)("produces bounded actionable content for $kind", (decision) => {
    const content = interventionContent(decision);
    expect(content).toContain("Stop the current approach.");
    expect(content).toContain("Choose one materially different next action.");
    expect(content).toContain("Evidence:");
    expect(content.length).toBeLessThan(1_000);
    expect(decisionLabel(decision).length).toBeGreaterThan(0);
  });

  it("reports rounded action similarity", () => {
    expect(
      interventionContent({ count: 4, kind: "continuation_churn", similarity: 0.912 }),
    ).toContain("91% action similarity");
  });
});
