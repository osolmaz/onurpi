import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WIDGET_KEY } from "./command.ts";
import { CONFIG_FILE_NAME } from "./config.ts";
import { ContextBudgetSession, STATUS_KEY, type UiContext } from "./session-policy.ts";

type Notification = { message: string; type: string | undefined };

type Recorded = {
  ctx: UiContext;
  notifications: Notification[];
  statuses: (string | undefined)[];
  widgets: (string[] | undefined)[];
};

function recorder(overrides: { hasUI?: boolean; tokens?: number | null } = {}): Recorded {
  const notifications: Notification[] = [];
  const statuses: (string | undefined)[] = [];
  const widgets: (string[] | undefined)[] = [];
  const ctx: UiContext = {
    hasUI: overrides.hasUI ?? true,
    ui: {
      notify: (message, type) => {
        notifications.push({ message, type });
      },
      setStatus: (_key, text) => {
        statuses.push(text);
      },
      setWidget: (_key, content) => {
        widgets.push(content);
      },
    },
    getContextUsage: () => ({ tokens: overrides.tokens ?? null, contextWindow: 32_768 }),
  };
  return { ctx, notifications, statuses, widgets };
}

function agentDir(config?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "context-budget-session-"));
  if (config !== undefined) {
    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify(config), "utf8");
  }
  return dir;
}

/** A rendered prompt whose measured size is predictable: one large context file block. */
function prompt(size = 1000): string {
  return [
    "You are an expert coding assistant.",
    "",
    '<project_instructions path="/home/AGENTS.md">',
    "x".repeat(size),
    "</project_instructions>",
  ].join("\n");
}

describe("ContextBudgetSession", () => {
  it("warns once when the beginning context is over budget", () => {
    const session = new ContextBudgetSession({
      agentDir: agentDir({ warnChars: 100, warnTokens: 0 }),
    });
    const first = recorder();
    session.onSessionStart({ prompt: prompt() }, first.ctx);
    expect(first.notifications).toHaveLength(1);
    expect(first.notifications[0]?.type).toBe("warning");
    expect(first.notifications[0]?.message).toContain("context-budget");

    session.onBeforeAgentStart({ prompt: prompt() }, first.ctx);
    expect(first.notifications).toHaveLength(1);
  });

  it("stays quiet under the budget but still sets the status line", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir({ warnChars: 100_000 }) });
    const { ctx, notifications, statuses } = recorder();
    session.onSessionStart({ prompt: prompt(10) }, ctx);
    expect(notifications).toEqual([]);
    expect(statuses.at(-1)).toContain("context ");
  });

  it("stays silent when disabled but still answers the command", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir({ enabled: false }) });
    const { ctx, notifications, statuses, widgets } = recorder();
    session.onSessionStart({ prompt: prompt(5000) }, ctx);
    expect(notifications).toEqual([]);
    expect(statuses).toEqual([]);
    session.command("show", ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("info");
    expect(widgets).toHaveLength(1);
  });

  it("stays quiet without a UI", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir({ warnChars: 10 }) });
    const { ctx, notifications } = recorder({ hasUI: false });
    session.onSessionStart({ prompt: prompt(500) }, ctx);
    expect(notifications).toEqual([]);
  });

  it("clears its status and widget on shutdown", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx, statuses, widgets } = recorder();
    session.onSessionStart({ prompt: prompt(10) }, ctx);
    session.onSessionShutdown(ctx);
    expect(statuses.at(-1)).toBeUndefined();
    expect(widgets.at(-1)).toBeUndefined();
  });

  it("adds context files and reports duplicates in the snapshot", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx } = recorder();
    const same = "policy text";
    session.onSessionStart({ prompt: prompt(4) }, ctx);
    session.onBeforeAgentStart(
      {
        prompt: prompt(4),
        files: [
          { path: "/home/AGENTS.md", content: same },
          { path: "/home/.pi/agent/AGENTS.md", content: same },
          { path: "/home/other.md", content: "other" },
        ],
      },
      ctx,
    );
    const files = session.snapshot().measurement?.files ?? [];
    expect(files).toHaveLength(3);
    expect(session.snapshot().measurement?.promptChars).toBe(prompt(4).length);
    expect(files.filter((file) => file.hash === files[0]?.hash)).toHaveLength(2);
  });

  it("replaces the tool estimate with the request payload", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx } = recorder();
    session.onSessionStart(
      { prompt: prompt(4), tools: [{ name: "read", description: "read files" }] },
      ctx,
    );
    expect(session.current?.toolSource).toBe("metadata");
    session.onRequest(
      { payload: { tools: [{ name: "exec", description: "x".repeat(100) }] }, prompt: prompt(4) },
      ctx,
    );
    expect(session.current?.toolSource).toBe("request");
    expect(session.current?.tools.map((tool) => tool.name)).toEqual(["exec"]);
  });

  it("ignores a payload without tools", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx } = recorder();
    session.onSessionStart({ prompt: prompt(4) }, ctx);
    session.onRequest({ payload: { messages: [] }, prompt: prompt(4) }, ctx);
    expect(session.current?.toolSource).toBe("metadata");
  });

  it("lists the context files of the session from the prompt alone", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx } = recorder();
    const same = "policy text";
    const rendered = [
      "You are an expert coding assistant.",
      "",
      `<project_instructions path="/home/AGENTS.md">\n${same}\n</project_instructions>`,
      "",
      `<project_instructions path="/home/.pi/agent/AGENTS.md">\n${same}\n</project_instructions>`,
    ].join("\n");
    session.onSessionStart({ prompt: rendered }, ctx);
    const files = session.snapshot().measurement?.files ?? [];
    expect(files.map((file) => file.path)).toEqual([
      "/home/AGENTS.md",
      "/home/.pi/agent/AGENTS.md",
    ]);
    expect(files[0]?.hash).toBe(files[1]?.hash);
    session.command("show", ctx);
  });

  it("records conversation usage for the report", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx } = recorder({ tokens: 12_000 });
    session.onSessionStart({ prompt: prompt(4) }, ctx);
    expect(session.snapshot().conversationTokens).toBe(12_000);
    expect(session.snapshot().contextWindow).toBe(32_768);
  });

  it("reports a broken config once at session start and keeps working", () => {
    const dir = agentDir();
    writeFileSync(join(dir, CONFIG_FILE_NAME), "{oops", "utf8");
    const session = new ContextBudgetSession({ agentDir: dir });
    const { ctx, notifications } = recorder();
    session.onSessionStart({ prompt: prompt(4) }, ctx);
    expect(notifications[0]?.message).toContain("is not valid JSON");
    expect(session.current?.promptChars).toBe(prompt(4).length);
  });

  it("picks up a new config on reload", () => {
    const dir = agentDir({ warnChars: 100_000, warnTokens: 0 });
    const session = new ContextBudgetSession({ agentDir: dir });
    const { ctx, notifications } = recorder();
    session.onSessionStart({ prompt: prompt(500) }, ctx);
    expect(notifications).toEqual([]);

    writeFileSync(
      join(dir, CONFIG_FILE_NAME),
      JSON.stringify({ warnChars: 10, warnTokens: 0 }),
      "utf8",
    );
    expect(session.reload()).toEqual([]);
    session.onBeforeAgentStart({ prompt: prompt(500) }, ctx);
    expect(notifications).toHaveLength(1);
  });

  it("shows the report through the command", () => {
    const session = new ContextBudgetSession({ agentDir: agentDir() });
    const { ctx, widgets } = recorder();
    session.onSessionStart({ prompt: prompt(4) }, ctx);
    session.command("show", ctx);
    expect(widgets.at(-1)?.join("\n")).toContain("beginning context");
    expect(widgets.at(-1)?.join("\n")).toContain("config: ");
    session.command("clear", ctx);
    expect(widgets.at(-1)).toBeUndefined();
    expect(WIDGET_KEY).toBe("context-budget");
    expect(STATUS_KEY).toBe("context-budget");
  });
});
