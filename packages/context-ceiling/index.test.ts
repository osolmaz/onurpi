import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import contextCeiling from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

type FakePi = {
  on: (event: string, handler: Handler) => () => void;
  registerCommand: (name: string, options: { description?: string; handler: Handler }) => void;
};

type Recorded = {
  pi: FakePi;
  handlers: Map<string, Handler[]>;
  commands: { name: string; handler: Handler }[];
  notifications: { message: string; type?: string }[];
  statuses: (string | undefined)[];
  compactCalls: number;
  compactOptions: { onComplete?: () => void; onError?: (error: Error) => void }[];
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
  };
  return {
    pi,
    handlers,
    commands,
    notifications,
    statuses,
    compactCalls: 0,
    compactOptions: [],
  };
}

function fakeContext(
  recorded: Recorded,
  overrides: {
    tokens?: number | null;
    idle?: boolean;
    pending?: boolean;
  } = {},
): unknown {
  return {
    mode: "tui",
    ui: {
      notify: (message: string, type?: string) => {
        recorded.notifications.push(type === undefined ? { message } : { message, type });
      },
      setStatus: (key: string, text: string | undefined) => {
        if (key !== "context-ceiling") throw new Error(`unexpected status key ${key}`);
        recorded.statuses.push(text);
      },
    },
    getContextUsage: () => ({
      tokens: overrides.tokens ?? null,
      contextWindow: 1_000_000,
    }),
    isIdle: () => overrides.idle ?? true,
    hasPendingMessages: () => overrides.pending ?? false,
    compact: (options?: { onComplete?: () => void; onError?: (error: Error) => void }) => {
      recorded.compactCalls += 1;
      if (options) recorded.compactOptions.push(options);
    },
  };
}

function emit(recorded: Recorded, event: string, ctx: unknown): void {
  for (const handler of recorded.handlers.get(event) ?? []) handler({ type: event }, ctx);
}

describe("context-ceiling extension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("registers the lifecycle hooks and the command", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    expect([...recorded.handlers.keys()].sort()).toEqual([
      "agent_before_settle",
      "agent_settled",
      "session_shutdown",
      "session_start",
      "turn_end",
    ]);
    expect(recorded.commands.map((command) => command.name)).toEqual(["context-ceiling"]);
  });

  test("waits during a busy run and compacts after the session settles", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const busy = fakeContext(recorded, { tokens: 273_000, idle: false });
    emit(recorded, "turn_end", busy);
    expect(recorded.compactCalls).toBe(0);
    expect(recorded.notifications).toEqual([]);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const idle = fakeContext(recorded, { tokens: 273_000, idle: true });
    emit(recorded, "agent_settled", idle);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
    expect(recorded.notifications[0]?.message).toContain("— compacting");
    expect(recorded.statuses.at(-1)).toBeUndefined();
  });

  test("skips the scheduled compaction when a settled continuation starts first", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    let idle = true;
    const ctx = fakeContext(recorded, { tokens: 273_000 });
    (ctx as { isIdle: () => boolean }).isIdle = () => idle;
    emit(recorded, "agent_settled", ctx);
    idle = false;
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(0);

    idle = true;
    emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
  });

  test("skips the scheduled compaction while messages are pending", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, { tokens: 273_000, idle: true, pending: true });
    emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(0);
  });

  test("does not re-request while a compaction is in flight", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, { tokens: 273_000, idle: true });
    emit(recorded, "agent_settled", ctx);
    emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
  });

  test("stays quiet at or below the ceiling and clears the wait status", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const over = fakeContext(recorded, { tokens: 273_000, idle: false });
    emit(recorded, "turn_end", over);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const under = fakeContext(recorded, { tokens: 271_000, idle: false });
    emit(recorded, "turn_end", under);
    expect(recorded.compactCalls).toBe(0);
    expect(recorded.statuses.at(-1)).toBeUndefined();
  });

  test("reports a failed compaction and retries on a later settle", () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const ctx = fakeContext(recorded, { tokens: 273_000, idle: true });
    emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(1);
    expect(recorded.notifications[0]?.message).toContain("— compacting");

    recorded.compactOptions[0]?.onError?.(new Error("provider unavailable"));
    expect(recorded.notifications.at(-1)?.type).toBe("warning");

    emit(recorded, "agent_settled", ctx);
    vi.advanceTimersByTime(0);
    expect(recorded.compactCalls).toBe(2);
  });

  test("turning the ceiling off clears the wait status", async () => {
    const recorded = harness();
    contextCeiling(recorded.pi as never);
    const busy = fakeContext(recorded, { tokens: 273_000, idle: false });
    emit(recorded, "turn_end", busy);
    expect(recorded.statuses.at(-1)).toContain("compacting when the run settles");

    const command = recorded.commands[0]?.handler;
    const ctx = fakeContext(recorded);
    await command?.("off", ctx);
    expect(recorded.statuses.at(-1)).toBeUndefined();
    expect(recorded.notifications.at(-1)?.message).toBe("Context ceiling off");
  });
});
