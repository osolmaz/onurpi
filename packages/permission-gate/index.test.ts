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

type HarnessOptions = {
  choice?: string | undefined;
  hasUI?: boolean | undefined;
  mode?: "tui" | "rpc" | "print" | "json" | undefined;
  signal?: AbortSignal | undefined;
  key?: string | undefined;
};

type Harness = {
  pi: ExtensionAPI;
  handlers: Map<string, Handler[]>;
  commands: Map<string, Handler>;
  select: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  custom: ReturnType<typeof vi.fn>;
  context: ExtensionContext;
};

const TOOLS = [
  { name: "clip", annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "read", annotations: { destructiveHint: true } },
];

function createHarness(options: HarnessOptions = {}): Harness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Handler>();
  const select = vi.fn(() => Promise.resolve(options.choice));
  const notify = vi.fn();
  const custom = vi.fn(
    (
      factory: (
        tui: unknown,
        theme: unknown,
        keybindings: unknown,
        done: (result: boolean) => void,
      ) => { handleInput(data: string): void },
    ) =>
      new Promise<boolean>((resolve) => {
        const theme = { fg: (_color: string, text: string) => text };
        const keybindings = { matches: (data: string) => data === "\u001b" };
        const component = factory({}, theme, keybindings, resolve);
        if (options.key !== undefined) component.handleInput(options.key);
      }),
  );

  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn((name: string, commandOptions: { handler: Handler }) => {
      commands.set(name, commandOptions.handler);
    }),
    getAllTools: vi.fn(() => TOOLS),
  } as unknown as ExtensionAPI;

  const context = {
    mode: options.mode ?? "rpc",
    hasUI: options.hasUI ?? true,
    signal: options.signal,
    ui: { select, notify, custom },
  } as unknown as ExtensionContext;

  permissionGate(pi);
  return { pi, handlers, commands, select, notify, custom, context };
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
  it("registers the command and the tool call hook", () => {
    const harness = createHarness();
    expect(harness.commands.has(COMMAND_NAME)).toBe(true);
    expect(harness.handlers.get("tool_call")).toHaveLength(1);
    expect([...harness.handlers.keys()]).toEqual(["tool_call"]);
  });

  it("asks with a selector outside the TUI", async () => {
    const harness = createHarness({ choice: "Deny" });
    const result = await toolCall(harness, event("write", { path: "a.txt" }));
    expect(harness.select).toHaveBeenCalledWith(
      "Allow this call?\n\nwrite: a.txt",
      ["Deny", "Allow once"],
      undefined,
    );
    expect(result).toEqual({ block: true, reason: "write was not approved, so it did not run." });
  });

  it("hands the abort signal to the selector", async () => {
    const controller = new AbortController();
    const harness = createHarness({ choice: "Deny", signal: controller.signal });
    await toolCall(harness, event("write", { path: "a.txt" }));
    expect(harness.select.mock.calls[0]?.[2]).toEqual({ signal: controller.signal });
  });

  it("blocks when the dialog is dismissed", async () => {
    const harness = createHarness({ choice: undefined });
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toMatchObject({
      block: true,
    });
  });

  it("runs the call after allow once", async () => {
    const harness = createHarness({ choice: "Allow once" });
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toBeUndefined();
  });

  it("uses the component dialog in the TUI and denies on n", async () => {
    const harness = createHarness({ mode: "tui", key: "n" });
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toEqual({
      block: true,
      reason: "write was not approved, so it did not run.",
    });
    expect(harness.custom).toHaveBeenCalledTimes(1);
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("asks again for a call nested inside an approved call", async () => {
    const harness = createHarness({ choice: "Allow once" });
    await toolCall(harness, event("codemode", { code: "1" }, { toolCallId: "call-1" }));
    const nested = await toolCall(
      harness,
      event("bash", { command: "ls" }, { toolCallId: "call-1/0", parentToolCallId: "call-1" }),
    );
    expect(nested).toBeUndefined();
    expect(harness.select).toHaveBeenCalledTimes(2);
  });

  it("asks every time, including for the same tool", async () => {
    const harness = createHarness({ choice: "Allow once" });
    await toolCall(harness, event("bash", { command: "ls" }));
    await toolCall(harness, event("bash", { command: "pwd" }));
    expect(harness.select).toHaveBeenCalledTimes(2);
  });

  it("passes local reads without a dialog", async () => {
    const harness = createHarness({ choice: "Deny" });
    expect(await toolCall(harness, event("grep", { pattern: "x" }))).toBeUndefined();
    expect(await toolCall(harness, event("clip", { text: "x" }))).toBeUndefined();
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("asks for a read tool that declares destructiveHint", async () => {
    const harness = createHarness({ choice: "Deny" });
    expect(await toolCall(harness, event("read", { path: "a.txt" }))).toMatchObject({
      block: true,
    });
  });

  it("blocks without an interactive UI", async () => {
    const harness = createHarness({ choice: "Allow once", hasUI: false });
    expect(await toolCall(harness, event("write", { path: "a.txt" }))).toEqual({
      block: true,
      reason: NO_UI_REASON,
    });
    expect(harness.select).not.toHaveBeenCalled();
  });

  it("toggles the gate with the command", async () => {
    const harness = createHarness({ choice: "Deny" });
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
});

describe("side effects", () => {
  const forbidden = [
    "setStatus",
    "setWidget",
    "setFooter",
    "setHeader",
    "setWorkingMessage",
    "appendEntry",
    "sendMessage",
    "setTitle",
    "writeFileSync",
    "appendFileSync",
  ];

  function sourceFiles(): string[] {
    const dir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(join(dir, "src"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => join(dir, "src", name));
    return [join(dir, "index.ts"), ...sources];
  }

  it("uses no interface, session, or disk write surface", () => {
    for (const file of sourceFiles()) {
      const text = readFileSync(file, "utf8");
      for (const name of forbidden) expect(text).not.toContain(name);
    }
  });

  it("covers every production file", () => {
    const names = sourceFiles().map((file) => file.split("/").at(-1));
    expect(names).toEqual([
      "index.ts",
      "approval.ts",
      "command.ts",
      "gate-state.ts",
      "policy.ts",
      "summary.ts",
    ]);
  });
});
