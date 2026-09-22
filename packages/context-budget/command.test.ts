import { describe, expect, it } from "vitest";

import { WIDGET_KEY, handleContextBudgetCommand, type CommandContext } from "./command.ts";
import { DEFAULT_CONFIG, type ReportInput } from "./context-budget.ts";

type Notification = { message: string; type: string };

type Recorded = {
  ctx: CommandContext;
  notifications: Notification[];
  widgets: (string[] | undefined)[];
};

function recorder(): Recorded {
  const notifications: Notification[] = [];
  const widgets: (string[] | undefined)[] = [];
  const ctx: CommandContext = {
    ui: {
      notify: (message, type) => {
        notifications.push({ message, type });
      },
      setWidget: (_key, content) => {
        widgets.push(content);
      },
    },
  };
  return { ctx, notifications, widgets };
}

function report(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    configPath: "/tmp/context-budget.json",
    config: DEFAULT_CONFIG,
    measurement: undefined,
    errors: [],
    ...overrides,
  };
}

describe("handleContextBudgetCommand", () => {
  it("prints the report and sets the widget", () => {
    const { ctx, notifications, widgets } = recorder();
    handleContextBudgetCommand("", { snapshot: () => report(), reload: () => [] }, ctx);
    expect(widgets[0]?.join("\n")).toContain("context-budget: enabled");
    expect(notifications[0]?.message).toContain("context-budget: enabled");
    expect(WIDGET_KEY).toBe("context-budget");
  });

  it("accepts the show keyword", () => {
    const { ctx, widgets } = recorder();
    handleContextBudgetCommand(" show ", { snapshot: () => report(), reload: () => [] }, ctx);
    expect(widgets).toHaveLength(1);
  });

  it("clears the widget", () => {
    const { ctx, notifications, widgets } = recorder();
    handleContextBudgetCommand("clear", { snapshot: () => report(), reload: () => [] }, ctx);
    expect(widgets[0]).toBeUndefined();
    expect(notifications[0]?.message).toContain("cleared");
  });

  it("reports config problems from a reload", () => {
    const { ctx, notifications } = recorder();
    handleContextBudgetCommand(
      "reload",
      { snapshot: () => report(), reload: () => ["bad key"] },
      ctx,
    );
    expect(notifications[0]?.type).toBe("warning");
    expect(notifications[0]?.message).toContain("bad key");
  });

  it("reloads quietly when the config is good, then prints the report", () => {
    const { ctx, notifications } = recorder();
    handleContextBudgetCommand("reload", { snapshot: () => report(), reload: () => [] }, ctx);
    expect(notifications[0]?.message).toContain("context-budget");
    expect(notifications[0]?.type).toBe("info");
  });

  it("rejects an unknown argument with usage text", () => {
    const { ctx, notifications, widgets } = recorder();
    handleContextBudgetCommand("nonsense", { snapshot: () => report(), reload: () => [] }, ctx);
    expect(notifications[0]?.message).toContain("Usage: /context-budget");
    expect(widgets).toEqual([]);
  });
});
