import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_FILE_NAME } from "./config.ts";
import type { ContextMessages } from "./context-policy.ts";
import { DEFAULT_CONFIG } from "./image-budget.ts";
import type { ResizeImage, ToolResultContent } from "./result-policy.ts";
import { ImageBudgetSession, type UiContext } from "./session-policy.ts";

const temporaryDirs: string[] = [];

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "image-budget-session-"));
  temporaryDirs.push(dir);
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

function tinyConfig(values: Record<string, number>): string {
  const dir = temporaryDir();
  const path = join(dir, CONFIG_FILE_NAME);
  writeFileSync(
    path,
    JSON.stringify({
      maxImageBytes: 100,
      imageBudgetBytes: 500,
      redactToBytes: 300,
      ...values,
    }),
  );
  return dir;
}

function image(bytes: number): ToolResultContent[number] {
  return { type: "image", data: "a".repeat(bytes), mimeType: "image/jpeg" };
}

function toolResult(content: ToolResultContent): ContextMessages[number] {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "unified-exec",
    content,
    isError: false,
    timestamp: 1,
  };
}

const resizeToNull: ResizeImage = () => Promise.resolve(null);

function session(agentDir: string): ImageBudgetSession {
  return new ImageBudgetSession({ agentDir, resize: resizeToNull });
}

describe("ImageBudgetSession", () => {
  it("starts from defaults when no config file exists", () => {
    const current = session(temporaryDir());
    const snapshot = current.snapshot();
    expect(snapshot.config).toEqual(DEFAULT_CONFIG);
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.configPath.endsWith(CONFIG_FILE_NAME)).toBe(true);
  });

  it("reports a broken config at session start", () => {
    const dir = temporaryDir();
    writeFileSync(join(dir, CONFIG_FILE_NAME), '{"maxImageBytes": "huge"}');
    const current = session(dir);
    const first = recorder();
    current.onSessionStart(first.ctx);
    expect(first.notifications).toEqual([
      {
        message: "image-budget: maxImageBytes must be a positive whole number",
        type: "warning",
      },
    ]);
  });

  it("stays quiet at session start with a valid config and without a terminal", () => {
    const current = session(tinyConfig({}));
    const quiet = recorder({ hasUI: false });
    current.onSessionStart(quiet.ctx);
    expect(quiet.notifications).toEqual([]);
    expect(current.snapshot().config.maxImageBytes).toBe(100);
  });

  it("reports nothing when a tool result needs no change", async () => {
    const current = session(tinyConfig({}));
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    const result = await current.onToolResult([{ type: "text", text: "ok" }], ctx);
    expect(result).toBeUndefined();
    expect(notifications).toEqual([]);
  });

  it("reports and patches a tool result once per turn", async () => {
    const current = session(tinyConfig({}));
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    const first = await current.onToolResult([image(400)], ctx);
    expect(first?.content[0]?.type).toBe("text");
    const second = await current.onToolResult([image(400)], ctx);
    expect(second?.content[0]?.type).toBe("text");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("dropped 1 image");
    expect(notifications[0]?.type).toBe("info");
    current.onTurnStart();
    await current.onToolResult([image(400)], ctx);
    expect(notifications).toHaveLength(2);
    expect(current.snapshot().outcome.dropped).toBe(3);
  });

  it("ignores tool results and context while disabled", async () => {
    const current = session(tinyConfig({}));
    const { ctx, notifications } = recorder();
    writeFileSync(join(current.path), JSON.stringify({ enabled: false }));
    current.onSessionStart(ctx);
    expect(await current.onToolResult([image(400)], ctx)).toBeUndefined();
    const messages: ContextMessages = [toolResult([image(400)])];
    expect(current.onContext(messages, ctx)).toBeUndefined();
    expect(notifications).toEqual([]);
  });

  it("redacts and warns when a context exceeds the budget", () => {
    const current = session(tinyConfig({}));
    const { ctx, notifications } = recorder();
    current.onSessionStart(ctx);
    const messages: ContextMessages = [toolResult([image(400)]), toolResult([image(400)])];
    const result = current.onContext(messages, ctx);
    expect(result?.messages).toBe(messages);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("redacted 1 old image");
    expect(notifications[0]?.type).toBe("warning");
    expect(current.snapshot().redactions).toBe(1);
    current.onContext(messages, ctx);
    expect(notifications).toHaveLength(1);
    expect(current.snapshot().redactions).toBe(1);
  });

  it("reports the load in the snapshot without touching the UI", () => {
    const current = session(tinyConfig({}));
    const { ctx, notifications } = recorder({ hasUI: false });
    current.onSessionStart(ctx);
    const messages: ContextMessages = [toolResult([image(100)])];
    expect(current.onContext(messages, ctx)).toBeUndefined();
    expect(notifications).toEqual([]);
    expect(current.snapshot().lastBytes).toBe(100);
    expect(current.snapshot().lastImageCount).toBe(1);
  });

  it("serves the command and reloads the config", () => {
    const dir = tinyConfig({});
    const current = session(dir);
    const { ctx, notifications } = recorder();
    current.command("", ctx);
    expect(notifications[0]?.message).toContain("image-budget: enabled");
    writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({ maxImagesPerResult: 7 }));
    current.command("reload", ctx);
    expect(current.snapshot().config.maxImagesPerResult).toBe(7);
    current.command("nonsense", ctx);
    expect(notifications.at(-1)).toEqual({
      message: "Usage: /image-budget [status|reload]",
      type: "warning",
    });
  });
});
