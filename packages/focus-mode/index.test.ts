import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONFIG_PATH_ENV } from "./config.ts";
import focusMode from "./index.ts";
import { claim, leaseDir, listLeases, readOwnLease, requestStop, sessionSlug } from "./store.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;

type Harness = {
  sessionFile: string;
  notes: string[];
  statuses: (string | undefined)[];
  editor(): string;
  aborts(): number;
  emit(name: string, event?: unknown): Promise<unknown>;
  command(args: string): Promise<void>;
};

const SESSION_A = "/sessions/a.jsonl";
const SESSION_B = "/sessions/b.jsonl";
const SESSION_C = "/sessions/c.jsonl";

function makeHarness(sessionFile: string, flags: Record<string, string> = {}): Harness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, CommandHandler>();
  const notes: string[] = [];
  const statuses: (string | undefined)[] = [];
  const session = { editorText: "", abortCount: 0 };

  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: "/home/onur/repo",
    sessionManager: { getSessionFile: () => sessionFile },
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort: () => {
      session.abortCount += 1;
    },
    ui: {
      notify: (message: string) => {
        notes.push(message);
      },
      setStatus: (_key: string, text: string | undefined) => {
        statuses.push(text);
      },
      getEditorText: () => session.editorText,
      setEditorText: (text: string) => {
        session.editorText = text;
      },
    },
  } as unknown as ExtensionContext;

  const pi = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerCommand: (name: string, options: { handler: CommandHandler }) => {
      commands.set(name, options.handler);
    },
    registerFlag: () => undefined,
    getFlag: (name: string) => flags[name],
    sendUserMessage: () => {
      throw new Error("a refused prompt must never be sent");
    },
    appendEntry: () => {
      throw new Error("focus mode must not write session entries");
    },
  } as unknown as ExtensionAPI;

  focusMode(pi);

  return {
    sessionFile,
    notes,
    statuses,
    editor: () => session.editorText,
    aborts: () => session.abortCount,
    emit: async (name: string, event?: unknown) => {
      let last: unknown;
      for (const handler of handlers.get(name) ?? []) last = await handler(event, ctx);
      return last;
    },
    command: async (args: string) => {
      const handler = commands.get("focus");
      if (handler === undefined) throw new Error("no focus command");
      await handler(args, ctx);
    },
  };
}

async function start(harness: Harness): Promise<void> {
  await harness.emit("session_start", { type: "session_start", reason: "startup" });
}

async function prompt(harness: Harness, text: string): Promise<unknown> {
  return harness.emit("input", { type: "input", text, source: "interactive" });
}

describe("focus mode wiring", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "focus-mode-index-"));
    configPath = join(dir, "focus-mode.json");
    process.env[CONFIG_PATH_ENV] = configPath;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    vi.useRealTimers();
  });

  it("claims a slot for the first prompt and leaves the status bar alone", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await expect(prompt(harness, "hello")).resolves.toEqual({ action: "continue" });
    const leases = leaseDir(configPath);
    expect(listLeases(leases).leases).toHaveLength(1);
    expect(harness.statuses).toEqual([]);
  });

  it("refuses a prompt at the cap, keeps the text, and writes no entry", async () => {
    const first = makeHarness(SESSION_A);
    const second = makeHarness(SESSION_B);
    await start(first);
    await start(second);
    await prompt(first, "long work");
    await prompt(second, "also long");

    const third = makeHarness(SESSION_C);
    await start(third);
    await expect(prompt(third, "keep me")).resolves.toEqual({ action: "handled" });
    expect(third.editor()).toBe("keep me");
    expect(third.notes.at(-1)).toContain("Focus mode: 2 of 2 agents are working");
    expect(third.statuses).toEqual([]);
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(2);
  });

  it("reports attached images in the refusal", async () => {
    const first = makeHarness(SESSION_A);
    const second = makeHarness(SESSION_B);
    await start(first);
    await start(second);
    await prompt(first, "long work");
    await prompt(second, "also long");
    const third = makeHarness(SESSION_C);
    await start(third);
    await third.emit("input", {
      type: "input",
      text: "look",
      source: "interactive",
      images: [{ type: "image" }],
    });
    expect(third.notes.at(-1)).toContain("1 image could not be restored.");
  });

  it("accepts the waiting prompt once a holder settles", async () => {
    const first = makeHarness(SESSION_A);
    const second = makeHarness(SESSION_B);
    await start(first);
    await start(second);
    await prompt(first, "long work");
    await prompt(second, "also long");
    const third = makeHarness(SESSION_C);
    await start(third);
    await prompt(third, "wait for me");

    await first.emit("agent_settled", { type: "agent_settled" });
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(1);
    await expect(prompt(third, "wait for me")).resolves.toEqual({ action: "continue" });
  });

  it("stops itself when its own lease carries a stop request", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "long work");
    const sessionId = sessionSlug(SESSION_A, process.pid);
    requestStop(leaseDir(configPath), sessionId, new Date().toISOString());

    await harness.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 0 });
    expect(harness.aborts()).toBe(1);
    expect(harness.notes.at(-1)).toContain("stopped this session");
  });

  it("asks a newer foreign lease to stop when the count is over the cap", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "long work");
    const leases = leaseDir(configPath);
    const now = Date.now();
    claim(leases, {
      sessionId: "foreign-old",
      pid: 1,
      sessionFile: "/sessions/old.jsonl",
      cwd: "/tmp",
      now: new Date(now + 10_000).toISOString(),
    });
    claim(leases, {
      sessionId: "foreign-new",
      pid: 1,
      sessionFile: "/sessions/new.jsonl",
      cwd: "/tmp",
      now: new Date(now + 60_000).toISOString(),
    });

    await harness.emit("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 0 });
    expect(harness.aborts()).toBe(0);
    expect(readOwnLease(leases, "foreign-new")?.stopRequestedAt).toBeTruthy();
    expect(readOwnLease(leases, "foreign-old")?.stopRequestedAt).toBeNull();
  });

  it("passes the prompt through when the store cannot be used", async () => {
    // A path under a regular file cannot hold a directory, so the claim fails immediately.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "not a directory\n");
    process.env[CONFIG_PATH_ENV] = join(blocker, "config.json");
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await expect(prompt(harness, "still works")).resolves.toEqual({ action: "continue" });
    expect(harness.notes.at(-1)).toContain("this prompt was allowed");
  });

  it("creates no lease when the feature is off", async () => {
    const offPath = join(dir, "off.json");
    writeFileSync(offPath, JSON.stringify({ enabled: false }));
    process.env[CONFIG_PATH_ENV] = offPath;
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await expect(prompt(harness, "one")).resolves.toEqual({ action: "continue" });
    expect(listLeases(leaseDir(offPath)).leases).toHaveLength(0);
    expect(harness.statuses).toEqual([]);
  });

  it("releases the lease on shutdown", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "long work");
    await harness.emit("session_shutdown", { type: "session_shutdown", reason: "quit" });
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(0);
  });

  it("honours the per-session cap flag", async () => {
    const harness = makeHarness(SESSION_A, { "focus-max": "1" });
    await start(harness);
    await prompt(harness, "only one");
    expect(harness.statuses).toEqual([]);
  });

  it("reports status, lists holders, and writes a new cap", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await harness.command("status");
    expect(harness.notes.at(-1)).toBe("focus 0/2 · ready");
    await harness.command("list");
    expect(harness.notes.at(-1)).toBe("Focus mode: no other session holds a lease.");
    await prompt(harness, "work");
    await harness.command("list");
    expect(harness.notes.at(-1)).toContain("1 of 2 agents working.");
    await harness.command("max 3");
    expect(harness.notes.at(-1)).toBe("Focus mode cap set to 3 for future sessions.");
    const written: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    expect(written).toMatchObject({ maxAgents: 3 });
    await harness.command("max nope");
    expect(harness.notes.at(-1)).toContain("use /focus max <number>");
  });
});

describe("focus mode claim confirmation", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(join(tmpdir(), "focus-mode-confirm-"));
    configPath = join(dir, "focus-mode.json");
    process.env[CONFIG_PATH_ENV] = configPath;
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, CONFIG_PATH_ENV);
    vi.useRealTimers();
  });

  it("releases a claim when no turn starts", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "hello");
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6000);
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(0);
    expect(harness.statuses).toEqual([]);
  });

  it("keeps the claim once a turn starts", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "hello");
    await harness.emit("before_agent_start", { type: "before_agent_start" });
    await vi.advanceTimersByTimeAsync(6000);
    expect(listLeases(leaseDir(configPath)).leases).toHaveLength(1);
  });

  it("clamps the cap for this session too", async () => {
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "work");
    await harness.command("max 99");
    await harness.command("status");
    expect(harness.notes.at(-1)).toBe("focus 1/16 · held");
  });

  it("reports a config error once per session", async () => {
    writeFileSync(configPath, "{ broken");
    const harness = makeHarness(SESSION_A);
    await start(harness);
    await prompt(harness, "hello");
    const configNotes = harness.notes.filter((note) => note.startsWith("Focus mode config:"));
    expect(configNotes).toHaveLength(1);
  });
});
