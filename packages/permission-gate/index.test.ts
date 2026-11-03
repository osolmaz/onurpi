import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import permissionGate, { COMMAND_NAME, ENV_VAR, initialGateEnabled } from "./index.ts";
import { NO_UI_REASON } from "./src/policy.ts";

type Handler = (...args: never[]) => unknown;

type Harness = {
  pi: ExtensionAPI;
  handlers: Map<string, Handler[]>;
  commands: Map<string, Handler>;
  select: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  context: ExtensionContext;
};

function createHarness(choice?: string, hasUI = true): Harness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Handler>();
  const select = vi.fn(() => Promise.resolve(choice));
  const notify = vi.fn();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn((name: string, options: { handler: Handler }) => {
      commands.set(name, options.handler);
    }),
    getAllTools: vi.fn(() => [{ name: "clip", annotations: { readOnlyHint: true } }]),
  } as unknown as ExtensionAPI;
  const context = { hasUI, ui: { select, notify } } as unknown as ExtensionContext;
  permissionGate(pi);
  return { pi, handlers, commands, select, notify, context };
}

function event(
  toolName: string,
  input: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): ToolCallEvent {
  return {
    type: "tool_call",
    toolName,
    input,
    toolCallId: "call-1",
    ...extra,
  } as unknown as ToolCallEvent;
}

type ToolCallResult = { block?: boolean; reason?: string } | undefined;

function toolCall(harness: Harness, called: ToolCallEvent): Promise<ToolCallResult> {
  const handler = harness.handlers.get("tool_call")?.[0];
  const result = handler?.(...([called, harness.context] as never[]));
  return Promise.resolve(result as ToolCallResult);
}

function command(harness: Harness, args: string): Promise<void> {
  const handler = harness.commands.get(COMMAND_NAME);
  const context = harness.context as unknown as ExtensionCommandContext;
  return Promise.resolve(handler?.(...([args, context] as never[])) as Promise<void>);
}

describe("initialGateEnabled", () => {
  it("is on by default", () => {
    expect(initialGateEnabled({})).toBe(true);
  });

  it("reads the off values", () => {
    for (const value of ["off", "OFF", " false ", "0", "no"]) {
      expect(initialGateEnabled({ [ENV_VAR]: value })).toBe(false);
    }
  });

  it("stays on for other values", () => {
    expect(initialGateEnabled({ [ENV_VAR]: "on" })).toBe(true);
  });
});

describe("permission gate", () => {
  it("registers the command and the hooks", () => {
    const harness = createHarness();
    expect(harness.commands.has(COMMAND_NAME)).toBe(true);
    for (const name of [
      "tool_call",
      "session_start",
      "session_before_switch",
      "session_before_fork",
    ]) {
      expect(harness.handlers.get(name)).toHaveLength(1);
    }
  });

  it("asks before a write and blocks on deny", async () => {
    const harness = createHarness("Deny");
    const result = await toolCall(harness, event("write", { path: "a.txt" }));
    expect(harness.select).toHaveBeenCalledWith("Allow this call?\n\nwrite: a.txt", [
      "Allow once",
      "Always allow write in this session",
      "Deny",
    ]);
    expect(result).toEqual({ block: true, reason: "write was not approved, so it did not run." });
  });

  it("blocks when the dialog is dismissed", async () => {
    const harness = createHarness(undefined);
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toMatchObject({
      block: true,
    });
  });

  it("runs the call after allow once", async () => {
    const harness = createHarness("Allow once");
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toBeUndefined();
  });

  it("covers nested calls once the parent is approved", async () => {
    const harness = createHarness("Allow once");
    await toolCall(harness, event("codemode", { code: "1" }, { toolCallId: "call-1" }));
    const nested = await toolCall(
      harness,
      event("bash", { command: "ls" }, { toolCallId: "call-1/0", parentToolCallId: "call-1" }),
    );
    expect(nested).toBeUndefined();
    expect(harness.select).toHaveBeenCalledTimes(1);
  });

  it("stops asking for a tool allowed for the session", async () => {
    const harness = createHarness("Always allow bash in this session");
    await toolCall(harness, event("bash", { command: "ls" }));
    expect(await toolCall(harness, event("bash", { command: "pwd" }))).toBeUndefined();
    expect(harness.select).toHaveBeenCalledTimes(1);
  });

  it("passes read-only calls without a dialog", async () => {
    const harness = createHarness("Deny");
    expect(await toolCall(harness, event("read", { path: "a.txt" }))).toBeUndefined();
    expect(await toolCall(harness, event("clip", { text: "x" }))).toBeUndefined();
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("blocks without an interactive UI", async () => {
    const harness = createHarness("Allow once", false);
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toEqual({
      block: true,
      reason: NO_UI_REASON,
    });
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("toggles the gate with the command", async () => {
    const harness = createHarness("Deny");
    await command(harness, "off");
    expect(harness.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Permission gate: off"),
      "info",
    );
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toBeUndefined();
    expect(harness.select).not.toHaveBeenCalled();

    await command(harness, "");
    expect(harness.notify).toHaveBeenLastCalledWith(
      expect.stringContaining("Permission gate: on"),
      "info",
    );
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toMatchObject({
      block: true,
    });
  });

  it("reports usage for an unknown word", async () => {
    const harness = createHarness();
    await command(harness, "maybe");
    expect(harness.notify).toHaveBeenCalledWith("Usage: /gate [on|off|status]", "error");
  });

  it("forgets session approvals when a session starts", async () => {
    const harness = createHarness("Always allow bash in this session");
    await toolCall(harness, event("bash", { command: "ls" }));
    harness.handlers.get("session_start")?.[0]?.();
    await toolCall(harness, event("bash", { command: "pwd" }));
    expect(harness.select).toHaveBeenCalledTimes(2);
  });
});

describe("status lines", () => {
  it("does not use a status, widget, footer, or header surface", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "");
    const files = [
      join(dir, "index.ts"),
      ...readdirSync(join(dir, "src")).map((name) => join(dir, "src", name)),
    ];
    const forbidden = ["setStatus", "setWidget", "setFooter", "setHeader", "setWorkingMessage"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const name of forbidden) expect(text).not.toContain(name);
    }
  });
});
