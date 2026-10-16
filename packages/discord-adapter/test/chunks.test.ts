import { describe, expect, it } from "vitest";
import { DISCORD_MESSAGE_LIMIT, splitForDiscord } from "../src/chunks.ts";

describe("splitForDiscord", () => {
  it("keeps a short answer whole", () => {
    expect(splitForDiscord("  short answer  ")).toEqual(["short answer"]);
  });

  it("says so when the answer is empty", () => {
    expect(splitForDiscord("   ")).toEqual(["(empty answer)"]);
  });

  it("prefers paragraph breaks, then lines, then words", () => {
    expect(splitForDiscord("aaaa bbbb\n\ncccc", 12)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitForDiscord("aaaa bbbb\ncccc", 12)).toEqual(["aaaa bbbb", "cccc"]);
    expect(splitForDiscord("aaaa bbbb cccc", 12)).toEqual(["aaaa bbbb", "cccc"]);
  });

  it("cuts a long word at the limit", () => {
    expect(splitForDiscord("x".repeat(25), 10)).toEqual([
      "x".repeat(10),
      "x".repeat(10),
      "x".repeat(5),
    ]);
  });

  it("keeps every chunk within Discord's limit", () => {
    const answer = Array.from({ length: 900 }, (_, index) => `word${String(index)}`).join(" ");
    const chunks = splitForDiscord(answer);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT);
    expect(chunks.join(" ")).toBe(answer);
  });
});
