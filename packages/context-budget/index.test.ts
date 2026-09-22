import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import contextBudget, { registerContextBudget } from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakePi = {
  on: (event: string, handler: Handler) => () => void;
  registerCommand: (name: string, options: { handler: Handler }) => void;
  getActiveTools: () => string[];
  getAllTools: () => { name: string; description: string; parameters: unknown }[];
};

type Recorded = {
  pi: FakePi;
  handlers: Map<string, Handler[]>;
  commands: { name: string; handler: Handler }[];
  notifications: { message: string; type?: string }[];
  statuses: (string | undefined)[];
};

function harness(): Recorded {
  const handlers = new Map<string, Handler[]>();
  const commands: { name: string; handler: Handler }[] = [];
  const notifications: { message: string; type?: string }[] = [];
  const statuses: (string | undefined)[] = [];
  const pi: FakePi = {
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      return () => undefined;
    },
    registerCommand: (name, options) => {
      commands.push({ name, handler: options.handler });
    },
    getActiveTools: () => ["read", "exec"],
    getAllTools: () => [
      { name: "read", description: "Read a file", parameters: { type: "object" } },
      { name: "exec", description: "Run a command", parameters: { type: "object" } },
      { name: "inactive", description: "Not active", parameters: {} },
    ],
  };
  return { pi, handlers, commands, notifications, statuses };
}

function budgetAgentDir(overrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "context-budget-index-"));
  writeFileSync(join(dir, "context-budget.json"), JSON.stringify(overrides), "utf8");
  return dir;
}

function fakeContext(recorded: Recorded): unknown {
  return {
    hasUI: true,
    ui: {
      notify: (message: string, type?: string) => {
        recorded.notifications.push(type === undefined ? { message } : { message, type });
      },
      setStatus: (_key: string, text: string | undefined) => {
        recorded.statuses.push(text);
      },
      setWidget: () => undefined,
    },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 32768 }),
    getSystemPrompt: () =>
      `<project_instructions path="/home/AGENTS.md">\n${"x".repeat(200)}\n</project_instructions>`,
  };
}

describe("context-budget extension", () => {
  it("exports a Pi extension factory", () => {
    expect(typeof contextBudget).toBe("function");
    expect(contextBudget).toHaveLength(1);
  });

  it("registers the four hooks and the command", () => {
    const { pi, handlers, commands } = harness();
    registerContextBudget(pi as never, { agentDir: budgetAgentDir() });
    expect([...handlers.keys()].sort()).toEqual([
      "before_agent_start",
      "before_provider_request",
      "session_shutdown",
      "session_start",
    ]);
    expect(commands.map((command) => command.name)).toEqual(["context-budget"]);
  });

  it("warns over budget and stays quiet the second time", async () => {
    const recorded = harness();
    registerContextBudget(recorded.pi as never, {
      agentDir: budgetAgentDir({ warnChars: 100, warnTokens: 0 }),
    });
    const ctx = fakeContext(recorded);
    for (const handler of recorded.handlers.get("session_start") ?? []) {
      await handler({ type: "session_start", reason: "startup" }, ctx);
    }
    expect(recorded.notifications[0]?.type).toBe("warning");
    for (const handler of recorded.handlers.get("before_agent_start") ?? []) {
      await handler(
        {
          type: "before_agent_start",
          prompt: "hello",
          systemPrompt: "",
          systemPromptOptions: { contextFiles: [], skills: [] },
        },
        ctx,
      );
    }
    expect(recorded.notifications).toHaveLength(1);
    expect(recorded.statuses.length).toBeGreaterThan(0);
  });

  it("accepts the provider payload and the shutdown hook", async () => {
    const recorded = harness();
    registerContextBudget(recorded.pi as never, { agentDir: budgetAgentDir() });
    const ctx = fakeContext(recorded);
    for (const handler of recorded.handlers.get("session_start") ?? []) {
      await handler({ type: "session_start", reason: "startup" }, ctx);
    }
    for (const handler of recorded.handlers.get("before_provider_request") ?? []) {
      await handler(
        { type: "before_provider_request", payload: { tools: [{ name: "exec" }] } },
        ctx,
      );
    }
    for (const handler of recorded.handlers.get("session_shutdown") ?? []) {
      await handler({ type: "session_shutdown", reason: "quit" }, ctx);
    }
    expect(recorded.statuses.at(-1)).toBeUndefined();
  });

  it("serves the command with a report", async () => {
    const recorded = harness();
    registerContextBudget(recorded.pi as never, { agentDir: budgetAgentDir() });
    const ctx = fakeContext(recorded);
    for (const handler of recorded.handlers.get("session_start") ?? []) {
      await handler({ type: "session_start", reason: "startup" }, ctx);
    }
    await recorded.commands[0]?.handler("show", ctx);
    expect(recorded.notifications.at(-1)?.message).toContain("beginning context");
  });

  it("installs itself with the default agent directory", () => {
    const { pi, commands } = harness();
    contextBudget(pi as never);
    expect(commands).toHaveLength(1);
  });
});
