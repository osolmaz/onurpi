import { describe, expect, it } from "vitest";

import { analyzeRestartArguments, replacementArguments } from "./arguments.ts";

describe("restart argument policy", () => {
  it("supports an ordinary launch", () => {
    expect(analyzeRestartArguments([])).toEqual({ supported: true, replayArgs: [] });
  });

  it("preserves safe flags and replaces the startup session", () => {
    const policy = analyzeRestartArguments([
      "--provider",
      "openai-codex",
      "--thinking",
      "high",
      "--offline",
      "--session",
      "/old session.jsonl",
      "-e",
      "/tmp/example.ts",
    ]);
    expect(policy).toEqual({
      supported: true,
      replayArgs: [
        "--provider",
        "openai-codex",
        "--thinking",
        "high",
        "--offline",
        "-e",
        "/tmp/example.ts",
      ],
    });
    expect(replacementArguments(policy, "/new session '$HOME'.jsonl")).toEqual([
      "--provider",
      "openai-codex",
      "--thinking",
      "high",
      "--offline",
      "-e",
      "/tmp/example.ts",
      "--session",
      "/new session '$HOME'.jsonl",
    ]);
  });

  it("rejects unsupported arguments", () => {
    const cases: readonly string[][] = [
      ["prompt"],
      ["--", "prompt"],
      ["--no-session"],
      ["-p"],
      ["--mode", "rpc"],
      ["--fork", "session"],
      ["--api-key", "secret"],
      ["--unknown"],
      ["--model=gpt"],
      ["--session", "one", "--session", "two"],
    ];
    for (const args of cases) expect(analyzeRestartArguments(args).supported).toBe(false);
  });

  it("reports missing values", () => {
    expect(analyzeRestartArguments(["--model"])).toEqual({
      supported: false,
      reason: "--model requires a value.",
    });
    expect(analyzeRestartArguments(["--session"])).toEqual({
      supported: false,
      reason: "--session requires a value.",
    });
  });

  it("does not build replacement arguments for an unsupported launch", () => {
    const policy = analyzeRestartArguments(["--no-session"]);
    expect(() => replacementArguments(policy, "/session.jsonl")).toThrow(/not compatible/u);
  });
});
