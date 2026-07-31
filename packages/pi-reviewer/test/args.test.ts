import { describe, expect, it } from "vitest";

import { parseArgs, parseModel, validateThinking } from "../src/args.js";
import { resolveSelection } from "../src/cli.js";

describe("review arguments", () => {
  it("parses every Codex review target", () => {
    expect(parseArgs(["--uncommitted"], "/repo")).toMatchObject({
      kind: "review",
      request: { cwd: "/repo", target: { kind: "uncommitted" } },
    });
    expect(
      parseArgs(["--base", "main", "--model", "openai-codex/reviewer", "--thinking", "high"]),
    ).toMatchObject({
      request: {
        target: { kind: "base", branch: "main" },
        model: "openai-codex/reviewer",
        thinking: "high",
      },
    });
    expect(parseArgs(["--commit", "abc", "--title", "Fix it"])).toMatchObject({
      request: { target: { kind: "commit", sha: "abc", title: "Fix it" } },
    });
    expect(parseArgs(["focus", "on", "cancellation"])).toMatchObject({
      request: { target: { kind: "custom", instructions: "focus on cancellation" } },
    });
  });

  it("parses config, login, models, help, and version commands", () => {
    expect(parseArgs(["config", "show"])).toEqual({ kind: "config-show" });
    expect(parseArgs(["config", "reset"])).toEqual({ kind: "config-reset" });
    expect(parseArgs(["config", "set", "model", "openai/model"])).toEqual({
      kind: "config-set-model",
      model: "openai/model",
    });
    expect(parseArgs(["config", "set", "thinking", "xhigh"])).toEqual({
      kind: "config-set-thinking",
      thinking: "xhigh",
    });
    expect(parseArgs(["login", "openai-codex"])).toEqual({
      kind: "login",
      provider: "openai-codex",
    });
    expect(parseArgs(["models", "terra"])).toEqual({ kind: "models", search: "terra" });
    expect(parseArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("rejects ambiguous and malformed arguments", () => {
    expect(() => parseArgs([])).toThrow("usage: pi-reviewer");
    expect(() => parseArgs(["--base"])).toThrow("--base requires a value");
    expect(() => parseArgs(["--base", "main", "--uncommitted"])).toThrow("mutually exclusive");
    expect(() => parseArgs(["--base", "main", "instructions"])).toThrow("mutually exclusive");
    expect(() => parseArgs(["--title", "title", "--base", "main"])).toThrow("--title requires");
    expect(() => parseArgs(["--unknown"])).toThrow("unknown option");
    expect(() => parseArgs(["config", "set", "other", "x"])).toThrow("config key");
    expect(() => parseArgs(["config", "set"])).toThrow("usage");
    expect(() => parseArgs(["login", "a", "b"])).toThrow("usage");
    expect(() => parseArgs(["models", "a", "b"])).toThrow("usage");
  });

  it("validates model and thinking values", () => {
    expect(parseModel("huggingface/org/model:route")).toEqual({
      provider: "huggingface",
      model: "org/model:route",
    });
    expect(() => parseModel("missing-provider")).toThrow("provider/model");
    expect(() => parseModel("/missing")).toThrow("provider/model");
    expect(() => validateThinking("extreme")).toThrow("thinking must be one of");
  });

  it("resolves external model defaults without a model in the extension", () => {
    expect(
      resolveSelection(undefined, undefined, {
        version: 1,
        model: "openai-codex/gpt-review",
        thinking: "high",
      }),
    ).toEqual({ provider: "openai-codex", model: "gpt-review", thinking: "high" });
    expect(
      resolveSelection("openai/other", "low", {
        version: 1,
        model: "openai-codex/gpt-review",
        thinking: "high",
      }),
    ).toEqual({ provider: "openai", model: "other", thinking: "low" });
    expect(() => resolveSelection(undefined, undefined, { version: 1 })).toThrow(
      "No review model configured",
    );
  });
});
