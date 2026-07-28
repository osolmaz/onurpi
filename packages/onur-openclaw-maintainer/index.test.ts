import { describe, expect, it, vi } from "vitest";

import onurOpenClawMaintainer from "./index.ts";
import {
  WORKFLOW_START_CHANNEL,
  WORKFLOW_START_RESULT_CHANNEL,
  type SharedEventBus,
  type WorkflowStartRequest,
} from "./maintainer.ts";

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

class TestBus implements SharedEventBus {
  private readonly handlers = new Map<string, ((data: unknown) => void)[]>();

  emit(channel: string, data: unknown): void {
    for (const handler of this.handlers.get(channel) ?? []) handler(data);
  }

  on(channel: string, handler: (data: unknown) => void): () => void {
    const handlers = this.handlers.get(channel) ?? [];
    handlers.push(handler);
    this.handlers.set(channel, handlers);
    return () => {
      this.handlers.set(
        channel,
        (this.handlers.get(channel) ?? []).filter((candidate) => candidate !== handler),
      );
    };
  }
}

function makeHarness() {
  const bus = new TestBus();
  const notifications: string[] = [];
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
    events: bus,
    getFlag: () => undefined,
    registerCommand: (_name: string, value: Command) => {
      command = value;
    },
    registerFlag: () => undefined,
    setSessionName: (name: string) => names.push(name),
    on: (event: string, handler: (...args: never[]) => unknown) => {
      lifecycle.set(event, handler);
      if (event === "tool_call") toolHandler = handler as ToolHandler;
    },
  };
  onurOpenClawMaintainer(pi as never);
  if (!command || !toolHandler) throw new Error("extension did not register expected handlers");
  return { bus, command, ctx, names, notifications, statuses, toolHandler };
}

describe("onur-openclaw-maintainer extension", () => {
  it("starts the bundled workflow for an exact issue", async () => {
    const harness = makeHarness();
    harness.bus.on(WORKFLOW_START_CHANNEL, (value) => {
      const request = value as WorkflowStartRequest;
      expect(request.input).toMatchObject({ issueNumber: 111886, allowMerge: false });
      harness.bus.emit(WORKFLOW_START_RESULT_CHANNEL, {
        requestId: request.requestId,
        ok: true,
        workflowName: "onur-openclaw-maintainer",
      });
    });

    await harness.command.handler("111886", harness.ctx);

    expect(harness.names).toEqual(["OpenClaw #111886 workflow test"]);
    expect(harness.notifications.at(-1)).toContain("This is a workflow test");
    expect(harness.statuses.at(-1)).toBe("OC #111886 workflow test");
  });

  it("blocks tracked writes and merge commands once the run starts", async () => {
    const harness = makeHarness();
    harness.bus.on(WORKFLOW_START_CHANNEL, (value) => {
      const request = value as WorkflowStartRequest;
      harness.bus.emit(WORKFLOW_START_RESULT_CHANNEL, {
        requestId: request.requestId,
        ok: true,
        workflowName: "onur-openclaw-maintainer",
      });
    });
    await harness.command.handler("111886", harness.ctx);

    expect(harness.toolHandler({ toolName: "edit", input: {} })?.block).toBe(true);
    expect(
      harness.toolHandler({ toolName: "exec_command", input: { cmd: "gh pr merge 1" } })?.block,
    ).toBe(true);
    expect(
      harness.toolHandler({ toolName: "exec_command", input: { cmd: "git status --short" } }),
    ).toBeUndefined();
  });

  it("reports a missing pi-workflows listener", async () => {
    vi.useFakeTimers();
    try {
      const harness = makeHarness();
      const pending = harness.command.handler("111886", harness.ctx);
      await vi.advanceTimersByTimeAsync(10_001);
      await pending;
      expect(harness.notifications.at(-1)).toContain("Timed out waiting for pi-workflows");
      expect(harness.statuses.at(-1)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
