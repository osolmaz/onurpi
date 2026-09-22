import { describe, expect, it } from "vitest";

import {
  DEFAULT_CONFIG,
  budgetWarning,
  duplicateGroups,
  estimateTokens,
  formatCount,
  measureContext,
  measureContextFiles,
  measurePrompt,
  parseContextFiles,
  measureRequestTools,
  measureTools,
  overBudget,
  overBudgetReasons,
  reportLines,
  statusText,
  toolDeclaration,
  type ContextBudgetConfig,
  type ContextMeasurement,
} from "./context-budget.ts";

function config(overrides: Partial<ContextBudgetConfig> = {}): ContextBudgetConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

const PROMPT = [
  "You are an expert coding assistant.",
  "",
  "<tools>",
  "- read: Read file contents",
  "</tools>",
  "",
  '<project_instructions path="/home/AGENTS.md">',
  "policy text",
  "</project_instructions>",
  "",
  "<skills>",
  "  <skill>",
  "    <name>alpha</name>",
  "  </skill>",
  "  <skill>",
  "    <name>beta</name>",
  "  </skill>",
  "</skills>",
].join("\n");

function measurement(overrides: Partial<ContextMeasurement> = {}): ContextMeasurement {
  return {
    promptChars: 0,
    toolChars: 0,
    totalChars: 0,
    sections: [],
    files: [],
    skillCount: 0,
    tools: [],
    toolSource: "metadata",
    ...overrides,
  };
}

describe("measurePrompt", () => {
  it("splits the preamble from tagged sections and counts skills", () => {
    const result = measurePrompt(PROMPT);
    expect(result.promptChars).toBe(PROMPT.length);
    expect(result.skillCount).toBe(2);
    expect(result.sections.map((section) => section.name)).toEqual([
      "preamble",
      "tools",
      "project_instructions",
      "skills",
    ]);
    expect(result.sections.find((section) => section.name === "tools")?.chars).toBe(
      "- read: Read file contents".length,
    );
  });

  it("handles an empty prompt and a prompt without tags", () => {
    expect(measurePrompt("")).toEqual({ promptChars: 0, sections: [], skillCount: 0 });
    expect(measurePrompt("plain text").sections).toEqual([{ name: "preamble", chars: 10 }]);
  });
});

describe("tool measurement", () => {
  it("serializes the fields a provider payload carries", () => {
    const text = toolDeclaration({ name: "read", description: "read files" });
    expect(JSON.parse(text)).toEqual({ name: "read", description: "read files", parameters: {} });
  });

  it("sorts tools by size, largest first", () => {
    const sizes = measureTools([
      { name: "small", description: "a" },
      { name: "large", description: "a".repeat(200) },
    ]);
    expect(sizes.map((tool) => tool.name)).toEqual(["large", "small"]);
  });

  it("reads the request payload tool array", () => {
    const sizes = measureRequestTools({ tools: [{ name: "exec", description: "x".repeat(50) }] });
    expect(sizes).toHaveLength(1);
    expect(sizes[0]?.name).toBe("exec");
    expect(sizes[0]?.chars).toBeGreaterThan(50);
  });

  it("ignores payloads without a tool array", () => {
    expect(measureRequestTools(undefined)).toEqual([]);
    expect(measureRequestTools("text")).toEqual([]);
    expect(measureRequestTools({ tools: "nope" })).toEqual([]);
    expect(measureRequestTools({ tools: [123] })[0]?.name).toBe("(unnamed)");
  });
});

describe("context files", () => {
  it("parses the rendered project instruction blocks", () => {
    const files = parseContextFiles(PROMPT);
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("/home/AGENTS.md");
    expect(files[0]?.content).toBe("policy text");
    expect(parseContextFiles("no blocks here")).toEqual([]);
  });

  it("detects identical content across files", () => {
    const files = measureContextFiles([
      { path: "/home/AGENTS.md", content: "same" },
      { path: "/home/.pi/agent/AGENTS.md", content: "same" },
      { path: "/home/other.md", content: "different" },
    ]);
    const groups = duplicateGroups(files);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.copies).toBe(2);
    expect(groups[0]?.chars).toBe(8);
    expect(groups[0]?.paths).toContain("/home/AGENTS.md");
  });

  it("reports no groups when every file differs", () => {
    const files = measureContextFiles([
      { path: "a", content: "1" },
      { path: "b", content: "2" },
    ]);
    expect(duplicateGroups(files)).toEqual([]);
  });
});

describe("measureContext", () => {
  it("adds the prompt and tool characters", () => {
    const result = measureContext({
      prompt: PROMPT,
      tools: [{ name: "read", description: "read files" }],
    });
    expect(result.promptChars).toBe(PROMPT.length);
    expect(result.toolChars).toBeGreaterThan(0);
    expect(result.totalChars).toBe(result.promptChars + result.toolChars);
    expect(result.toolSource).toBe("metadata");
  });

  it("falls back to the files rendered in the prompt", () => {
    const result = measureContext({ prompt: PROMPT });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.path).toBe("/home/AGENTS.md");
  });

  it("prefers explicit files over parsed ones", () => {
    const result = measureContext({ prompt: PROMPT, files: [{ path: "/x.md", content: "abc" }] });
    expect(result.files.map((file) => file.path)).toEqual(["/x.md"]);
  });

  it("prefers request tools over metadata", () => {
    const result = measureContext({
      prompt: "x",
      tools: [{ name: "ignored", description: "y" }],
      requestTools: [{ name: "real", chars: 42 }],
    });
    expect(result.toolSource).toBe("request");
    expect(result.tools).toEqual([{ name: "real", chars: 42 }]);
    expect(result.toolChars).toBe(42);
  });
});

describe("budget checks", () => {
  it("estimates tokens and guards a zero ratio", () => {
    expect(estimateTokens(4000, 4)).toBe(1000);
    expect(estimateTokens(4001, 4)).toBe(1001);
    expect(estimateTokens(10, 0)).toBe(10);
  });

  it("formats counts for people", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(118_443)).toBe("118.4K");
    expect(formatCount(2_500_000)).toBe("2.5M");
  });

  it("flags a character budget and a token budget separately", () => {
    const over = measurement({ totalChars: 118_443 });
    expect(overBudget(over, config({ warnChars: 100_000 }))).toBe(true);
    expect(overBudgetReasons(over, config({ warnChars: 100_000, warnTokens: 0 }))).toEqual([
      "over 100.0K characters",
    ]);
    expect(overBudgetReasons(over, config({ warnChars: 0, warnTokens: 24_000 }))).toEqual([
      "over 24.0K tokens",
    ]);
    expect(
      overBudgetReasons(over, config({ warnChars: 100_000, warnTokens: 24_000 })),
    ).toHaveLength(2);
    expect(overBudget(over, config({ warnChars: 0, warnTokens: 0 }))).toBe(false);
  });

  it("stays quiet under the budget or when disabled", () => {
    const small = measurement({ totalChars: 1000 });
    expect(budgetWarning(small, config())).toBeUndefined();
    expect(
      budgetWarning(measurement({ totalChars: 500_000 }), config({ enabled: false })),
    ).toBeUndefined();
    expect(
      budgetWarning(measurement({ totalChars: 500_000 }), config({ notify: false })),
    ).toBeUndefined();
  });

  it("names the numbers in the warning", () => {
    const message = budgetWarning(measurement({ totalChars: 118_443 }), config());
    expect(message).toContain("118.4K chars");
    expect(message).toContain("~29.6K tokens");
    expect(message).toContain("/context-budget");
  });

  it("renders a status line only when it applies", () => {
    const over = measurement({ totalChars: 118_443 });
    expect(statusText(over, config())).toBe("context! 118.4Kch ~29.6Ktok");
    expect(statusText(measurement({ totalChars: 1000 }), config())).toBe("context 1.0Kch ~250tok");
    expect(statusText(undefined, config())).toBeUndefined();
    expect(statusText(over, config({ status: false }))).toBeUndefined();
    expect(statusText(over, config({ enabled: false }))).toBeUndefined();
  });
});

describe("reportLines", () => {
  it("names the kind of tool measurement", () => {
    const lines = reportLines({
      configPath: "/tmp/context-budget.json",
      config: config(),
      measurement: measurement({ toolChars: 582, tools: [{ name: "workflow", chars: 582 }] }),
      errors: [],
    });
    expect(lines[0]).toBe("context-budget: enabled");
    expect(lines.join("\n")).toContain("tools: 582 chars (tool metadata)");
  });

  it("reports an unmeasured session, duplicates, and conversation use", () => {
    const files = measureContextFiles([
      { path: "/home/AGENTS.md", content: "same" },
      { path: "/home/.pi/agent/AGENTS.md", content: "same" },
    ]);
    const lines = reportLines({
      configPath: "/tmp/context-budget.json",
      config: config(),
      measurement: measurement({ totalChars: 200, files, toolSource: "request" }),
      errors: ["warnChars must be a whole number of at least 1"],
      conversationTokens: 12_000,
      contextWindow: 32_768,
    });
    const text = lines.join("\n");
    expect(text).toContain("duplicate content");
    expect(text).toContain("provider payload");
    expect(text).toContain("conversation now: 12000 / 32768 tokens");
    expect(text).toContain("config problems:");
  });

  it("reports a disabled session before a measurement exists", () => {
    const lines = reportLines({
      configPath: "/tmp/context-budget.json",
      config: config({ enabled: false }),
      measurement: undefined,
      errors: [],
    });
    expect(lines[0]).toBe("context-budget: disabled");
    expect(lines.join("\n")).toContain("beginning context: not measured yet");
  });
});
