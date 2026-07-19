import { describe, expect, it } from "vitest";

import { combineOutputTotals, deriveAssistantOutput } from "./output-metrics.ts";

describe("deriveAssistantOutput", () => {
  it("uses positive provider-reported output usage", () => {
    expect(
      deriveAssistantOutput({
        content: [{ text: "ignored estimate", type: "text" }],
        role: "assistant",
        usage: { output: 37 },
      }),
    ).toEqual({ approximate: false, tokens: 37 });
  });

  it("estimates finalized text and thinking content", () => {
    expect(
      deriveAssistantOutput({
        content: [
          { text: "hello", type: "text" },
          { thinking: "plan", type: "thinking" },
        ],
        role: "assistant",
        usage: { output: 0 },
      }),
    ).toEqual({ approximate: true, tokens: 3 });
  });

  it("estimates tool-call names and serialized arguments", () => {
    expect(
      deriveAssistantOutput({
        content: [
          {
            arguments: { command: "pwd" },
            name: "bash",
            type: "toolCall",
          },
        ],
        role: "assistant",
      }),
    ).toEqual({ approximate: true, tokens: 6 });
  });

  it("returns an exact zero for empty assistant output", () => {
    expect(deriveAssistantOutput({ content: [], role: "assistant" })).toEqual({
      approximate: false,
      tokens: 0,
    });
  });

  it("ignores malformed and unrelated message data", () => {
    const cyclicArguments: Record<string, unknown> = {};
    cyclicArguments["self"] = cyclicArguments;

    expect(deriveAssistantOutput(null)).toEqual({ approximate: false, tokens: 0 });
    expect(deriveAssistantOutput({ role: "user", usage: { output: 100 } })).toEqual({
      approximate: false,
      tokens: 0,
    });
    expect(
      deriveAssistantOutput({
        content: [
          { arguments: cyclicArguments, name: 1, type: "toolCall" },
          { text: 1, type: "text" },
          { type: "image" },
        ],
        role: "assistant",
        usage: { output: Number.NaN },
      }),
    ).toEqual({ approximate: false, tokens: 0 });
    expect(deriveAssistantOutput({ content: "invalid", role: "assistant" })).toEqual({
      approximate: false,
      tokens: 0,
    });
  });
});

describe("combineOutputTotals", () => {
  it("sums exact and estimated responses", () => {
    expect(
      combineOutputTotals([
        { approximate: false, tokens: 20 },
        { approximate: true, tokens: 3 },
        { approximate: true, tokens: 0 },
      ]),
    ).toEqual({ approximate: true, tokens: 23 });
  });

  it("combines exact responses without marking the total approximate", () => {
    expect(
      combineOutputTotals([
        { approximate: false, tokens: 20 },
        { approximate: false, tokens: 7 },
      ]),
    ).toEqual({ approximate: false, tokens: 27 });
  });
});
