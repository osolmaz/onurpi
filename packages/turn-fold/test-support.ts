import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

export type Handler = (...arguments_: unknown[]) => unknown;

export type ReplaySpy = {
  entries: (readonly unknown[])[];
  restore: () => void;
};

/**
 * Replaces Pi's transcript replay entry point with a recorder so tests can inspect the entries the
 * extension hands to Pi. The extension wraps whatever method it finds, so the recorder must be in
 * place before the extension loads.
 */
export function replayRecorder(): ReplaySpy {
  const prototype = InteractiveMode.prototype as unknown as Record<string, unknown>;
  const original = prototype["renderSessionEntries"];
  const entries: (readonly unknown[])[] = [];
  prototype["renderSessionEntries"] = function (replayed: readonly unknown[]): void {
    entries.push(replayed);
  };
  return {
    entries,
    restore: () => {
      prototype["renderSessionEntries"] = original;
    },
  };
}

export function entryId(entry: unknown): unknown {
  return typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined;
}

export function extensionHarness(): {
  appendEntry: ReturnType<typeof vi.fn>;
  commands: ReadonlyMap<string, Handler>;
  completions: ReadonlyMap<string, (prefix: string) => unknown>;
  handlers: ReadonlyMap<string, Handler>;
  pi: ExtensionAPI;
} {
  const commands = new Map<string, Handler>();
  const completions = new Map<string, (prefix: string) => unknown>();
  const eventHandlers = new Map<string, (data: unknown) => void>();
  const handlers = new Map<string, Handler>();
  const appendEntry = vi.fn();
  const emitEvent = (channel: string, data: unknown) => {
    eventHandlers.get(channel)?.(data);
  };
  const pi = {
    appendEntry,
    events: {
      emit: emitEvent,
      on: (channel: string, handler: (data: unknown) => void) => {
        eventHandlers.set(channel, handler);
        return () => eventHandlers.delete(channel);
      },
    },
    on: (event: string, handler: Handler) => handlers.set(event, handler),
    registerCommand: (
      name: string,
      definition: { getArgumentCompletions?: (prefix: string) => unknown; handler: Handler },
    ) => {
      commands.set(name, definition.handler);
      if (definition.getArgumentCompletions) {
        completions.set(name, definition.getArgumentCompletions);
      }
    },
    registerShortcut: () => undefined,
  } as unknown as ExtensionAPI;
  return { appendEntry, commands, completions, handlers, pi };
}

export function context(
  entries: readonly unknown[] = [],
  branch: readonly unknown[] = entries,
  sessionFile: string | null = "/tmp/turn-fold-session.jsonl",
) {
  let editorFactory: unknown;
  return {
    cwd: "/workspace/project",
    hasPendingMessages: vi.fn(() => false),
    hasUI: true,
    isIdle: vi.fn(() => true),
    mode: "tui",
    reload: vi.fn(() => Promise.resolve()),
    switchSession: vi.fn(() => Promise.resolve({ cancelled: false })),
    sessionManager: {
      buildContextEntries: () => entries,
      getBranch: () => branch,
      getSessionFile: () => sessionFile ?? undefined,
      getSessionId: () => "session-id",
    },
    ui: {
      confirm: vi.fn(() => Promise.resolve(true)),
      getEditorComponent: vi.fn(() => editorFactory),
      notify: vi.fn(),
      select: vi.fn(() => Promise.resolve(undefined)),
      setEditorComponent: vi.fn((factory: unknown) => {
        editorFactory = factory;
      }),
      setStatus: vi.fn(),
      theme: undefined,
    },
    waitForIdle: vi.fn(() => Promise.resolve()),
  };
}

export async function emit(
  handlers: ReadonlyMap<string, Handler>,
  event: string,
  payload: object,
  ctx: object,
): Promise<void> {
  await handlers.get(event)?.(payload, ctx);
}

export async function runTurnFoldCommand(
  commands: ReadonlyMap<string, Handler>,
  argument: string,
  ctx: object,
): Promise<void> {
  const handler = commands.get("turn-fold");
  if (!handler) throw new Error("Turn Fold command was not registered");
  await handler(argument, ctx);
}
