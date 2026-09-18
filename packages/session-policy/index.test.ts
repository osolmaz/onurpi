import {
  buildContextEntries,
  sessionEntryToContextMessages,
  SessionManager,
  type ExtensionAPI,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseMarkerText, type Marker } from "./marker.ts";
import {
  payloadHash,
  type ContextMessages,
  type ResizeImage,
  type ToolResultContent,
} from "./policy.ts";
import sessionPolicy, { registerSessionPolicy } from "./index.ts";

type Handler = (...args: never[]) => unknown;

type Harness = {
  pi: ExtensionAPI;
  handlers: Map<string, Handler[]>;
  commands: Map<string, Handler>;
};

function createMockPi(): Harness {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, Handler>();
  const pi = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    registerCommand: vi.fn((name: string, options: { handler: Handler }) => {
      commands.set(name, options.handler);
    }),
  } as unknown as ExtensionAPI;
  return { pi, handlers, commands };
}

function call(handlers: Map<string, Handler[]>, event: string, ...args: unknown[]): unknown {
  return handlers.get(event)?.[0]?.(...(args as never[]));
}

function invoke(handler: Handler | undefined, ...args: unknown[]): unknown {
  return handler?.(...(args as never[]));
}

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-policy-index-"));
  temporaryDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

const noResize: ResizeImage = () => Promise.resolve(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlock(value: unknown): value is ToolResultContent[number] {
  if (!isRecord(value)) return false;
  if (value["type"] === "text") return typeof value["text"] === "string";
  if (value["type"] === "image") return typeof value["data"] === "string";
  return false;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected an array");
  return value as unknown[];
}

function blocksOf(value: unknown): ToolResultContent {
  const blocks: ToolResultContent = [];
  for (const block of asArray(value)) {
    if (!isBlock(block)) throw new Error("unexpected content block");
    blocks.push(block);
  }
  return blocks;
}

/** Content of a `tool_result` patch, rejecting anything unexpected. */
function patchedContent(value: unknown): ToolResultContent {
  if (!isRecord(value)) throw new Error("expected a tool result patch");
  return blocksOf(value["content"]);
}

/** Content of the first message of a `context` patch. */
function attachedContent(value: unknown): ToolResultContent {
  if (!isRecord(value)) throw new Error("expected a context patch");
  const [first] = asArray(value["messages"]);
  if (!isRecord(first)) throw new Error("expected a message");
  return blocksOf(first["content"]);
}

function markerAt(content: ToolResultContent, index: number): Marker {
  const block = content[index];
  if (block?.type !== "text") throw new Error(`no text block at ${String(index)}`);
  const marker = parseMarkerText(block.text);
  if (marker === undefined) throw new Error(`no marker at ${String(index)}`);
  return marker;
}

function image(data: string): ToolResultContent[number] {
  return { type: "image", data, mimeType: "image/png" };
}

function toolResult(content: ToolResultContent, toolCallId = "call-1"): ContextMessages[number] {
  return {
    role: "toolResult",
    toolCallId,
    toolName: "read",
    content,
    isError: false,
    timestamp: 1,
  };
}

async function eject(
  handlers: Map<string, Handler[]>,
  data: string,
  path: string | undefined,
): Promise<ToolResultContent> {
  const input: Record<string, unknown> = path === undefined ? {} : { path };
  const result = await call(handlers, "tool_result", { content: [image(data)], input }, undefined);
  return patchedContent(result);
}

type FakeContext = {
  hasUI: boolean;
  ui: { notify: (message: string, type?: "info" | "warning" | "error") => void };
  sessionManager: { buildContextEntries: () => SessionEntry[] };
};

function context(
  entries: SessionEntry[],
  leafId: string | null,
  notifications: string[],
): FakeContext {
  return {
    hasUI: true,
    ui: {
      notify: (message) => {
        notifications.push(message);
      },
    },
    sessionManager: { buildContextEntries: () => buildContextEntries(entries, leafId) },
  };
}

function messageEntry(
  id: string,
  parentId: string | null,
  content: ToolResultContent,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: "2026-09-17T00:00:00.000Z",
    message: {
      role: "toolResult",
      toolCallId: `call-${id}`,
      toolName: "read",
      content,
      isError: false,
      timestamp: 1,
    },
  };
}

function compactionEntry(id: string, parentId: string, firstKeptEntryId: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: "2026-09-17T00:00:00.000Z",
    summary: "summary",
    firstKeptEntryId,
    tokensBefore: 100,
  };
}

/** The live entries of a branch, projected the way Pi projects them for the model. */
function projected(entries: SessionEntry[], leafId: string | null): ContextMessages {
  return buildContextEntries(entries, leafId).flatMap((entry) =>
    sessionEntryToContextMessages(entry),
  );
}

describe("session-policy extension", () => {
  it("exports a Pi extension factory", () => {
    expect(typeof sessionPolicy).toBe("function");
    expect(sessionPolicy).toHaveLength(1);
  });

  it("registers every hook and the command", () => {
    const { pi, handlers, commands } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    expect([...handlers.keys()].sort()).toEqual([
      "context",
      "session_compact",
      "session_shutdown",
      "session_start",
      "session_tree",
      "tool_result",
    ]);
    expect([...commands.keys()]).toEqual(["session-policy"]);
  });

  it("serves the command", () => {
    const { pi, commands } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    const notifications: string[] = [];
    const ctx = {
      hasUI: true,
      ui: {
        notify: (message: string) => {
          notifications.push(message);
        },
      },
    };
    invoke(commands.get("session-policy"), "", ctx);
    expect(notifications[0]).toContain("session-policy: enabled");
    expect(notifications[0]).toContain("ejected payloads: 0");
  });

  it("ejects at insert, re-attaches while live, and drops the cache at compaction", async () => {
    const { pi, handlers } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    const notifications: string[] = [];
    call(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      context([], null, notifications),
    );

    const dropped = await eject(handlers, "aaaa", "/tmp/a.png");
    const kept = await eject(handlers, "bbbb", "/tmp/b.png");
    const droppedMarker = markerAt(dropped, 0);
    const keptMarker = markerAt(kept, 0);
    expect(droppedMarker).toEqual({
      hash: payloadHash("aaaa"),
      mimeType: "image/png",
      chars: 4,
      source: "/tmp/a.png",
    });
    expect(keptMarker.source).toBe("/tmp/b.png");

    const messages: ContextMessages = [toolResult(dropped)];
    expect(
      attachedContent(call(handlers, "context", { messages }, context([], null, notifications))),
    ).toEqual([...dropped, image("aaaa")]);

    const entries: SessionEntry[] = [
      messageEntry("e1", null, dropped),
      compactionEntry("c1", "e1", "e2"),
      messageEntry("e2", "c1", kept),
    ];
    const live = JSON.stringify(projected(entries, "e2"));
    expect(live).toContain(payloadHash("bbbb"));
    expect(live).not.toContain(payloadHash("aaaa"));

    call(
      handlers,
      "session_compact",
      { type: "session_compact" },
      context(entries, "e2", notifications),
    );
    expect(
      call(handlers, "context", { messages }, context(entries, "e2", notifications)),
    ).toBeUndefined();
    expect(notifications.at(-1)).toContain("memory only");

    const keptMessages: ContextMessages = [toolResult(kept, "call-2")];
    expect(
      attachedContent(
        call(
          handlers,
          "context",
          { messages: keptMessages },
          context(entries, "e2", notifications),
        ),
      ),
    ).toEqual([...kept, image("bbbb")]);
  });

  it("evicts hashes that the new branch no longer references", async () => {
    const { pi, handlers } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    const notifications: string[] = [];
    call(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      context([], null, notifications),
    );

    const onBranch = await eject(handlers, "aaaa", undefined);
    const onOtherBranch = await eject(handlers, "bbbb", undefined);
    const entries: SessionEntry[] = [
      messageEntry("e1", null, onBranch),
      messageEntry("e2", "e1", onOtherBranch),
    ];
    call(handlers, "session_tree", { type: "session_tree" }, context(entries, "e1", notifications));

    const other: ContextMessages = [toolResult(onOtherBranch, "call-9")];
    expect(
      call(handlers, "context", { messages: other }, context(entries, "e1", notifications)),
    ).toBeUndefined();

    const branch: ContextMessages = [toolResult(onBranch, "call-8")];
    expect(
      attachedContent(
        call(handlers, "context", { messages: branch }, context(entries, "e1", notifications)),
      ),
    ).toEqual([...onBranch, image("aaaa")]);
  });
});

describe("session-policy extension lifecycle", () => {
  it("clears the cache on session shutdown", async () => {
    const { pi, handlers } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    const notifications: string[] = [];
    call(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      context([], null, notifications),
    );
    const content = await eject(handlers, "aaaa", undefined);
    call(
      handlers,
      "session_shutdown",
      { type: "session_shutdown", reason: "quit" },
      context([], null, notifications),
    );
    const messages: ContextMessages = [toolResult(content)];
    expect(
      call(handlers, "context", { messages }, context([], null, notifications)),
    ).toBeUndefined();
  });

  it("writes a loadable session file with no image bytes and re-attaches from it", async () => {
    const { pi, handlers } = createMockPi();
    registerSessionPolicy(pi, { agentDir: temporaryDir(), resize: noResize });
    const notifications: string[] = [];
    call(
      handlers,
      "session_start",
      { type: "session_start", reason: "startup" },
      context([], null, notifications),
    );
    const ejected = await eject(handlers, "aaaa", "/tmp/a.png");

    const dir = temporaryDir();
    const manager = SessionManager.create(dir, dir);
    manager.appendMessage({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: ejected,
      isError: false,
      timestamp: 1,
    });
    manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "A picture of a red and blue square." }],
      api: "test",
      provider: "test",
      model: "test-model",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    });
    const file = manager.getSessionFile();
    if (file === undefined) throw new Error("expected a session file");

    const reopened = SessionManager.open(file);
    const stored = JSON.stringify(reopened.getEntries());
    expect(stored).not.toContain('"type":"image"');
    expect(stored).toContain(payloadHash("aaaa"));

    const live = reopened
      .buildContextEntries()
      .flatMap((entry) => sessionEntryToContextMessages(entry));
    expect(
      attachedContent(
        call(handlers, "context", { messages: live }, context([], null, notifications)),
      ),
    ).toEqual([...ejected, image("aaaa")]);
  });
});
