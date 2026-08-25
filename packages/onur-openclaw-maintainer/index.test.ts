import { describe, expect, it } from "vitest";

import onurOpenClawMaintainer from "./index.ts";

type FakeContext = {
  hasUI: boolean;
  ui: {
    notify(message: string, type?: string): void;
    select(title: string, options: string[]): Promise<string | undefined>;
    setStatus(key: string, value: string | undefined): void;
  };
};

type Command = { handler(args: string, ctx: FakeContext): Promise<void> };
type ToolHandler = (event: {
  toolName: string;
  input: unknown;
}) => { block: true; reason: string } | undefined;

function makeHarness(options: { workflowLoaded?: boolean } = {}) {
  const notifications: string[] = [];
  const sentMessages: { content: string; expandPromptTemplates?: boolean }[] = [];
  const statuses: (string | undefined)[] = [];
  const names: string[] = [];
  let command: Command | undefined;
  let toolHandler: ToolHandler | undefined;
  const lifecycle = new Map<string, (...args: never[]) => unknown>();
  const ctx: FakeContext = {
    hasUI: true,
    ui: {
      notify: (message) => notifications.push(message),
      select: () => Promise.resolve(undefined),
      setStatus: (_key, value) => statuses.push(value),
    },
  };
  const pi = {
    getCommands: () =>
      options.workflowLoaded === false
        ? []
        : [{ name: "workflow", source: "extension", sourceInfo: {} }],
    getFlag: () => undefined,
    registerCommand: (_name: string, value: Command) => {
      command = value;
    },
    registerFlag: () => undefined,
    sendUserMessage: (content: string, sendOptions?: { expandPromptTemplates?: boolean }) =>
      sentMessages.push({
        content,
        ...(sendOptions?.expandPromptTemplates === undefined
          ? {}
          : { expandPromptTemplates: sendOptions.expandPromptTemplates }),
      }),
    setSessionName: (name: string) => names.push(name),
    on: (event: string, handler: (...args: never[]) => unknown) => {
      lifecycle.set(event, handler);
      if (event === "tool_call") toolHandler = handler as ToolHandler;
    },
  };
  onurOpenClawMaintainer(pi as never);
  if (!command || !toolHandler) throw new Error("extension did not register expected handlers");
  return { command, ctx, names, notifications, sentMessages, statuses, toolHandler };
}

describe("onur-openclaw-maintainer extension", () => {
  it("starts the bundled workflow for an exact issue", async () => {
    const harness = makeHarness();

    await harness.command.handler("111886", harness.ctx);

    expect(harness.names).toEqual(["OpenClaw #111886 workflow test"]);
    expect(harness.notifications.at(-1)).toContain("This is a workflow test");
    expect(harness.statuses.at(-1)).toBe("OC #111886 workflow test");
    expect(harness.sentMessages).toHaveLength(1);
    expect(harness.sentMessages[0]?.content).toContain(
      '/openclaw-maintainer.workflow.ts --input-json {"allowCommits":false',
    );
    expect(harness.sentMessages[0]?.expandPromptTemplates).toBe(true);
  });

  it("blocks tracked writes and merge commands once the run starts", async () => {
    const harness = makeHarness();
    await harness.command.handler("111886", harness.ctx);

    expect(harness.toolHandler({ toolName: "edit", input: {} })?.block).toBe(true);
    expect(
      harness.toolHandler({ toolName: "exec_command", input: { cmd: "gh pr merge 1" } })?.block,
    ).toBe(true);
    expect(
      harness.toolHandler({ toolName: "exec_command", input: { cmd: "git status --short" } }),
    ).toBeUndefined();
  });

  it("reports a missing pi-workflows command", async () => {
    const harness = makeHarness({ workflowLoaded: false });
    await harness.command.handler("111886", harness.ctx);
    expect(harness.notifications.at(-1)).toContain("Pi Workflows is not loaded");
    expect(harness.sentMessages).toHaveLength(0);
    expect(harness.statuses).toHaveLength(0);
  });
});
