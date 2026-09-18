import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME, DEFAULT_CONFIG } from "./config.ts";
import { buildMarkerText, type Marker } from "./marker.ts";
import {
  payloadHash,
  type ContextMessages,
  type ResizeImage,
  type ToolResultContent,
} from "./policy.ts";
import { SessionPolicy, sourcePath, type UiContext } from "./session.ts";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "session-policy-session-"));
  temporaryDirs.push(dir);
  return dir;
}

function configDir(values: Record<string, unknown>): string {
  const dir = temporaryDir();
  writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify(values));
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

type Recorded = {
  ctx: UiContext;
  notifications: { message: string; type: string | undefined }[];
};

function recorder(overrides: Partial<UiContext> = {}): Recorded {
  const notifications: { message: string; type: string | undefined }[] = [];
  const ctx: UiContext = {
    hasUI: true,
    ui: {
      notify: (message, type) => notifications.push({ message, type }),
    },
    ...overrides,
  };
  return { ctx, notifications };
}

function image(data: string, mimeType = "image/png"): ToolResultContent[number] {
  return { type: "image", data, mimeType };
}

function text(value: string): ToolResultContent[number] {
  return { type: "text", text: value };
}

function toolResult(content: ToolResultContent): ContextMessages[number] {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content,
    isError: false,
    timestamp: 1,
  };
}

function marker(data: string, source: string | undefined): Marker {
  return { hash: payloadHash(data), mimeType: "image/png", chars: data.length, source };
}

/** Content of the first message, which the re-attach cases expect to be a tool result. */
function resultContent(messages: ContextMessages): ToolResultContent {
  const message = messages[0];
  if (message?.role !== "toolResult") throw new Error("expected a tool result message");
  return message.content;
}

const noResize: ResizeImage = () => Promise.resolve(null);

function session(agentDir: string): SessionPolicy {
  return new SessionPolicy({ agentDir, resize: noResize });
}

describe("sourcePath", () => {
  it("reads a non-empty string path", () => {
    expect(sourcePath({ path: "/tmp/a.png" })).toBe("/tmp/a.png");
    expect(sourcePath({})).toBeUndefined();
    expect(sourcePath({ path: "" })).toBeUndefined();
    expect(sourcePath({ path: 42 })).toBeUndefined();
  });
});

describe("SessionPolicy", () => {
  it("starts from defaults when no config file exists", () => {
    const current = session(temporaryDir());
    expect(current.snapshot()).toEqual({
      configPath: current.path,
      config: DEFAULT_CONFIG,
      errors: [],
      cacheBytes: 0,
      cacheCount: 0,
      liveMarkers: 0,
      ejected: 0,
    });
    expect(current.path.endsWith(CONFIG_FILE_NAME)).toBe(true);
  });

  it("reports a broken config on session start", () => {
    const dir = temporaryDir();
    writeFileSync(join(dir, CONFIG_FILE_NAME), "{ nope");
    const current = session(dir);
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    expect(current.snapshot().errors[0]).toContain("is not valid JSON");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("warning");
    expect(notifications[0]?.message).toContain("session-policy:");
  });

  it("stays quiet about config problems without a UI", () => {
    const dir = temporaryDir();
    writeFileSync(join(dir, CONFIG_FILE_NAME), "{ nope");
    const current = session(dir);
    const { ctx, notifications } = recorder({ hasUI: false });
    current.onSessionStart(ctx);
    expect(notifications).toEqual([]);
  });

  it("ejects an image at insert time and caches the payload", async () => {
    const current = session(temporaryDir());
    const { ctx } = recorder();
    current.onSessionStart(ctx);
    const result = await current.onToolResult([image("aaaa")], { path: "/tmp/a.png" });
    expect(result?.content).toEqual([text(buildMarkerText(marker("aaaa", "/tmp/a.png")))]);
    expect(current.snapshot().ejected).toBe(1);
    expect(current.snapshot().cacheCount).toBe(1);
    expect(current.snapshot().cacheBytes).toBe(4);
  });

  it("counts two images from one result", async () => {
    const current = session(temporaryDir());
    await current.onToolResult([image("aaaa"), image("bbbb")], {});
    expect(current.snapshot().ejected).toBe(2);
    expect(current.snapshot().cacheCount).toBe(2);
    expect(current.snapshot().cacheBytes).toBe(8);
  });

  it("shares one cache entry for identical payloads", async () => {
    const current = session(temporaryDir());
    await current.onToolResult([image("aaaa")], {});
    await current.onToolResult([image("aaaa")], {});
    expect(current.snapshot().ejected).toBe(2);
    expect(current.snapshot().cacheCount).toBe(1);
    expect(current.snapshot().cacheBytes).toBe(4);
  });

  it("passes a marker-only result through", async () => {
    const current = session(temporaryDir());
    const content = [text(buildMarkerText(marker("aaaa", undefined)))];
    expect(await current.onToolResult(content, {})).toBeUndefined();
    expect(current.snapshot().ejected).toBe(0);
  });

  it("passes a text-only result through", async () => {
    const current = session(temporaryDir());
    expect(await current.onToolResult([text("plain")], {})).toBeUndefined();
    expect(current.snapshot().ejected).toBe(0);
  });
});

describe("SessionPolicy cache and command", () => {
  it("re-attaches the picture on the context hook while the marker is live", async () => {
    const current = session(temporaryDir());
    const { ctx } = recorder();
    const ejected = await current.onToolResult([image("aaaa")], {});
    if (ejected === undefined) throw new Error("expected an ejected result");
    const messages: ContextMessages = [toolResult(ejected.content)];
    const attached = current.onContext(messages, ctx);
    expect(resultContent(attached?.messages ?? [])).toEqual([...ejected.content, image("aaaa")]);
    expect(current.snapshot().liveMarkers).toBe(1);
    expect(current.snapshot().cacheCount).toBe(1);
  });

  it("passes a live marker through and notifies once per session when it is not cached", () => {
    const current = session(temporaryDir());
    const { ctx, notifications } = recorder();
    const messages: ContextMessages = [
      toolResult([text(buildMarkerText(marker("aaaa", "/tmp/a.png")))]),
    ];
    expect(current.onContext(messages, ctx)).toBeUndefined();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("info");
    expect(notifications[0]?.message).toContain("memory only");
    current.onContext(messages, ctx);
    expect(notifications).toHaveLength(1);
    expect(current.snapshot().liveMarkers).toBe(1);
  });

  it("stays quiet about a missing picture when notify is false", () => {
    const current = session(configDir({ notify: false }));
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    const messages: ContextMessages = [
      toolResult([text(buildMarkerText(marker("aaaa", undefined)))]),
    ];
    current.onContext(messages, ctx);
    expect(notifications).toEqual([]);
  });

  it("keeps a cache entry that is still live and drops the rest", async () => {
    const current = session(temporaryDir());
    const ejected = await current.onToolResult([image("aaaa")], {});
    if (ejected === undefined) throw new Error("expected an ejected result");
    expect(current.onLiveMessages([toolResult(ejected.content)])).toBe(0);
    expect(current.snapshot().cacheCount).toBe(1);
    const other: ContextMessages = [toolResult([text(buildMarkerText(marker("bbbb", undefined)))])];
    expect(current.onLiveMessages(other)).toBe(1);
    expect(current.snapshot().cacheCount).toBe(0);
    expect(current.snapshot().liveMarkers).toBe(1);
  });

  it("clears the cache and the counters on session shutdown", async () => {
    const current = session(temporaryDir());
    await current.onToolResult([image("aaaa")], {});
    current.onSessionShutdown();
    expect(current.snapshot().cacheCount).toBe(0);
    expect(current.snapshot().cacheBytes).toBe(0);
    expect(current.snapshot().ejected).toBe(0);
  });

  it("resets the counters on session start", async () => {
    const current = session(temporaryDir());
    const { ctx } = recorder();
    await current.onToolResult([image("aaaa")], {});
    current.onSessionStart(ctx);
    expect(current.snapshot().ejected).toBe(0);
    expect(current.snapshot().cacheCount).toBe(0);
  });

  it("is inert while disabled", async () => {
    const current = session(configDir({ enabled: false }));
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    expect(current.config.enabled).toBe(false);
    expect(await current.onToolResult([image("aaaa")], {})).toBeUndefined();
    const messages: ContextMessages = [
      toolResult([text(buildMarkerText(marker("aaaa", undefined)))]),
    ];
    expect(current.onContext(messages, ctx)).toBeUndefined();
    expect(notifications).toEqual([]);
  });

  it("reloads the config and re-bounds the cache with the command", async () => {
    const dir = temporaryDir();
    const current = session(dir);
    const { ctx, notifications } = recorder();
    await current.onToolResult([image("aaaa")], {});
    expect(current.snapshot().cacheCount).toBe(1);
    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({ cacheMaxBytes: 2 }));
    current.command("reload", ctx);
    expect(current.config.cacheMaxBytes).toBe(2);
    expect(current.snapshot().cacheCount).toBe(0);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("session-policy: enabled");
  });

  it("serves the command", () => {
    const current = session(temporaryDir());
    const { ctx, notifications } = recorder();
    current.command("", ctx);
    expect(notifications[0]?.message).toContain("ejected payloads: 0");
  });
});
