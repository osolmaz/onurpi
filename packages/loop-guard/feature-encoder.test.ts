import { describe, expect, it } from "vitest";

import {
  actionFeatureSimilarity,
  EpisodeBuilder,
  MAX_ACTIONS_PER_EPISODE,
  MAX_FEATURES_PER_EPISODE,
  MAX_TURNS_PER_EPISODE,
  normalizeVolatileText,
} from "./feature-encoder.ts";

function toolTurn(command: string, result = "done", id = "call-1"): [unknown, unknown[]] {
  return [
    {
      role: "assistant",
      stopReason: "toolUse",
      timestamp: 100,
      usage: { totalTokens: 10 },
      content: [
        {
          type: "toolCall",
          id,
          name: "exec_command",
          arguments: { cmd: command },
        },
      ],
    },
    [
      {
        role: "toolResult",
        toolCallId: id,
        toolName: "exec_command",
        isError: false,
        timestamp: 101,
        content: [{ type: "text", text: result }],
      },
    ],
  ];
}

function digest(command: string, result = "done", id = "call-1") {
  const builder = new EpisodeBuilder();
  const [message, toolResults] = toolTurn(command, result, id);
  builder.accountTurn(message, toolResults);
  return builder.finish(true);
}

describe("normalizeVolatileText", () => {
  it("normalizes volatile experiment values while preserving action words", () => {
    expect(
      normalizeVolatileText(
        "Python scan.py --position 60 --id 019fad22-c33f-7b73-a8d6-1d50db27661e /tmp/run-123.log",
      ),
    ).toBe("python scan.py --position <n> --id <uuid> /tmp/<tmp>");
  });
});

describe("EpisodeBuilder", () => {
  it("keeps exact outcomes stable across volatile ids and timestamps", () => {
    const first = digest("python scan.py --position 60", "same", "call-1");
    const second = digest("python scan.py --position 60", "same", "call-999");

    expect(first.exactOutcomeHash).toBe(second.exactOutcomeHash);
  });

  it("preserves meaningful ids inside tool arguments", () => {
    const first = new EpisodeBuilder();
    const second = new EpisodeBuilder();
    first.accountTurn(
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "volatile-call-1",
            name: "lookup",
            arguments: { id: "record-a" },
          },
        ],
      },
      [],
    );
    second.accountTurn(
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "volatile-call-2",
            name: "lookup",
            arguments: { id: "record-b" },
          },
        ],
      },
      [],
    );

    expect(first.finish(false).exactOutcomeHash).not.toBe(second.finish(false).exactOutcomeHash);
  });

  it("keeps changed finalized results distinct", () => {
    expect(digest("python scan.py", "result 1").exactOutcomeHash).not.toBe(
      digest("python scan.py", "result 2").exactOutcomeHash,
    );
  });

  it("gives parameter variants highly similar action features", () => {
    const first = digest("python scan.py --position 60 --cap 1000000");
    const second = digest("python scan.py --position 70 --cap 2000000");

    expect(actionFeatureSimilarity(first.actionFeatures, second.actionFeatures)).toBeGreaterThan(
      0.9,
    );
  });

  it("distinguishes materially different tool actions", () => {
    const first = digest("python scan.py --position 60");
    const second = digest("git status --short");

    expect(actionFeatureSimilarity(first.actionFeatures, second.actionFeatures)).toBeLessThan(0.5);
  });

  it("normalizes repeated terminal errors", () => {
    const first = new EpisodeBuilder();
    const second = new EpisodeBuilder();
    first.accountAgentEnd([
      { role: "assistant", stopReason: "error", errorMessage: "request 123 failed" },
    ]);
    second.accountAgentEnd([
      { role: "assistant", stopReason: "error", errorMessage: "request 999 failed" },
    ]);

    expect(first.finish(false).terminalErrorFingerprint).toBe(
      second.finish(false).terminalErrorFingerprint,
    );
  });

  it("clears a transient terminal error after a successful retry", () => {
    const builder = new EpisodeBuilder();
    builder.accountAgentEnd([
      { role: "assistant", stopReason: "error", errorMessage: "request 123 failed" },
    ]);
    builder.accountAgentEnd([
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "recovered" }] },
    ]);

    expect(builder.finish(false)).toMatchObject({
      terminalError: false,
      terminalErrorFingerprint: null,
    });
  });

  it("clears an error turn when a later retry turn succeeds", () => {
    const builder = new EpisodeBuilder();
    builder.accountTurn(
      { role: "assistant", stopReason: "error", errorMessage: "request 123 failed", content: [] },
      [],
    );
    builder.accountTurn(
      { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "recovered" }] },
      [],
    );

    expect(builder.finish(false).terminalError).toBe(false);
  });

  it("preserves meaningful error status codes", () => {
    const first = new EpisodeBuilder();
    const second = new EpisodeBuilder();
    first.accountAgentEnd([
      { role: "assistant", stopReason: "error", errorMessage: "HTTP status 400" },
    ]);
    second.accountAgentEnd([
      { role: "assistant", stopReason: "error", errorMessage: "HTTP status 500" },
    ]);

    expect(first.finish(false).terminalErrorFingerprint).not.toBe(
      second.finish(false).terminalErrorFingerprint,
    );
  });

  it("bounds turns, tool calls, and action features", () => {
    const builder = new EpisodeBuilder();
    for (let index = 0; index < MAX_TURNS_PER_EPISODE + 5; index += 1) {
      const content = Array.from({ length: MAX_ACTIONS_PER_EPISODE + 3 }, (_, action) => ({
        type: "toolCall",
        id: `${String(index)}-${String(action)}`,
        name: "custom_tool",
        arguments: { command: `command_${String(action)} --value ${String(index)}` },
      }));
      builder.accountTurn({ role: "assistant", stopReason: "toolUse", content }, []);
    }
    const result = builder.finish(false);

    expect(result.turns).toBe(MAX_TURNS_PER_EPISODE + 1);
    expect(result.toolCalls).toBeLessThanOrEqual(MAX_ACTIONS_PER_EPISODE + 1);
    expect(result.actionFeatures.length).toBeLessThanOrEqual(MAX_FEATURES_PER_EPISODE);
    expect(result.truncated).toBe(true);
  });

  it("marks bounded outcome text as truncated", () => {
    const result = digest("python scan.py", `prefix-${"x".repeat(10_000)}-suffix`);
    expect(result.truncated).toBe(true);
  });

  it("marks bounded message content arrays as truncated", () => {
    const builder = new EpisodeBuilder();
    builder.accountTurn(
      {
        role: "assistant",
        content: Array.from({ length: 65 }, (_, index) => ({
          type: "text",
          text: `part-${String(index)}`,
        })),
      },
      [],
    );
    expect(builder.finish(false).truncated).toBe(true);
  });

  it("does not fingerprint oversized terminal errors as repeatable", () => {
    const builder = new EpisodeBuilder();
    builder.accountAgentEnd([
      {
        role: "assistant",
        stopReason: "error",
        errorMessage: `prefix-${"x".repeat(10_000)}-suffix`,
      },
    ]);
    expect(builder.finish(false)).toMatchObject({
      terminalError: true,
      terminalErrorFingerprint: null,
    });
  });

  it("handles malformed external values without throwing", () => {
    const builder = new EpisodeBuilder();
    builder.accountTurn(
      {
        role: "assistant",
        content: [{ type: "toolCall", name: 3, arguments: Symbol("bad") }],
      },
      [null, "bad"],
    );

    expect(builder.finish(false).toolCalls).toBe(1);
  });
});

describe("actionFeatureSimilarity", () => {
  it("returns zero when either feature set is empty", () => {
    expect(actionFeatureSimilarity([], [1])).toBe(0);
    expect(actionFeatureSimilarity([1], [])).toBe(0);
  });

  it("computes exact Jaccard similarity for sorted sets", () => {
    expect(actionFeatureSimilarity([1, 2, 3], [2, 3, 4])).toBe(0.5);
  });
});
