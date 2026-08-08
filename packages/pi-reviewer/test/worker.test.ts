import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDefaultExecution,
  installRequestLimiter,
  runReviewWorker,
  workerMessagePayload,
} from "../src/worker.js";
import type { ReviewWorkerRequest } from "../src/worker-protocol.js";

const cleanup: string[] = [];

const REQUEST = {
  version: 1,
  cwd: "/repo",
  prompt: "review this",
  authPath: "/auth.json",
  modelsPath: "/models.json",
  configDir: "/config",
  extensionPath: "/review-guard.js",
  systemPrompt: "review",
  provider: "provider",
  model: "model",
  customModel: false,
  maxModelRequests: null,
  thinking: "high",
  tools: ["read"],
} satisfies ReviewWorkerRequest;

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

describe("request limiter", () => {
  it("steers a tool-using review to its final answer at the request limit", async () => {
    let listener: (event: AgentSessionEvent) => void = () => undefined;
    let removed = false;
    const calls: string[] = [];
    const limiter = installRequestLimiter(
      {
        subscribe: (next) => {
          listener = next;
          return () => {
            removed = true;
          };
        },
        abort: () => {
          calls.push("abort");
          return Promise.resolve();
        },
        prompt: (content) => {
          calls.push(`prompt:${content}`);
          return Promise.resolve();
        },
        setActiveToolsByName: (tools) => {
          calls.push(`tools:${tools.join(",")}`);
        },
      },
      2,
    );
    const event: AgentSessionEvent = {
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        api: "openai-completions",
        provider: "custom",
        model: "review-model",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: 1,
      },
    };

    listener(event);
    listener(event);
    listener(event);
    await limiter.finish();
    expect(calls).toHaveLength(3);
    expect(calls[0]).toBe("abort");
    expect(calls[1]).toBe("tools:");
    expect(calls[2]).toContain("Return the final review JSON");
    limiter.dispose();
    expect(removed).toBe(true);
  });
});

describe("review worker events", () => {
  it("creates an isolated in-memory Pi execution", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-worker-"));
    cleanup.push(root);
    const configDir = path.join(root, "config");
    const authPath = path.join(root, "auth.json");
    const extensionPath = path.join(root, "empty-extension.ts");
    await mkdir(configDir, { recursive: true });
    await writeFile(authPath, JSON.stringify({ anthropic: { type: "api_key", key: "test-key" } }), {
      mode: 0o600,
    });
    await writeFile(extensionPath, "export default function extension() {}\n");

    const execution = await createDefaultExecution({
      ...REQUEST,
      cwd: root,
      authPath,
      modelsPath: path.join(configDir, "models.json"),
      configDir,
      extensionPath,
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });
    const unsubscribe = execution.subscribe(() => undefined);
    unsubscribe();
    execution.dispose();
    await execution.flush();
  });

  it("uses a manifest-defined custom model without dynamic provider registration", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-custom-worker-"));
    cleanup.push(root);
    const configDir = path.join(root, "config");
    const modelsPath = path.join(configDir, "models.json");
    const extensionPath = path.join(root, "empty-extension.ts");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      modelsPath,
      JSON.stringify({
        providers: {
          custom: {
            baseUrl: "https://example.test/v1",
            api: "openai-completions",
            apiKey: "test-key",
            models: [
              {
                id: "review-model",
                name: "Review model",
                reasoning: true,
                input: ["text"],
                contextWindow: 131_072,
                maxTokens: 32_768,
              },
            ],
          },
        },
      }),
    );
    await writeFile(extensionPath, "export default function extension() {}\n");

    const execution = await createDefaultExecution({
      ...REQUEST,
      customModel: true,
      cwd: root,
      authPath: path.join(root, "auth.json"),
      modelsPath,
      configDir,
      extensionPath,
      provider: "custom",
      model: "review-model",
    });
    execution.dispose();
    await execution.flush();
  });

  it("rejects missing models and missing authentication", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-worker-errors-"));
    cleanup.push(root);
    const configDir = path.join(root, "config");
    await mkdir(configDir, { recursive: true });
    const request = {
      ...REQUEST,
      cwd: root,
      authPath: path.join(root, "auth.json"),
      modelsPath: path.join(configDir, "models.json"),
      configDir,
    };

    await expect(createDefaultExecution(request)).rejects.toThrow(
      "review model not found: provider/model",
    );
    await expect(
      createDefaultExecution({
        ...request,
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      }),
    ).rejects.toThrow("no authentication for review provider anthropic");
  });

  it("runs the prompt and always disposes its in-memory execution", async () => {
    const calls: string[] = [];
    await runReviewWorker(REQUEST, () =>
      Promise.resolve({
        subscribe: () => {
          calls.push("subscribe");
          return () => calls.push("unsubscribe");
        },
        prompt: (prompt) => {
          calls.push(`prompt:${prompt}`);
          return Promise.resolve();
        },
        dispose: () => calls.push("dispose"),
        flush: () => {
          calls.push("flush");
          return Promise.resolve();
        },
      }),
    );
    expect(calls).toEqual(["subscribe", "prompt:review this", "unsubscribe", "dispose", "flush"]);
  });

  it("cleans up when prompting fails", async () => {
    const calls: string[] = [];
    await expect(
      runReviewWorker(REQUEST, () =>
        Promise.resolve({
          subscribe: () => () => calls.push("unsubscribe"),
          prompt: () => Promise.reject(new Error("failed")),
          dispose: () => calls.push("dispose"),
          flush: () => {
            calls.push("flush");
            return Promise.resolve();
          },
        }),
      ),
    ).rejects.toThrow("failed");
    expect(calls).toEqual(["unsubscribe", "dispose", "flush"]);
  });

  it("forwards assistant responses without copying tool output", () => {
    const assistant = { role: "assistant", content: [{ type: "text", text: "result" }] };
    expect(workerMessagePayload(assistant)).toEqual({ type: "message_end", message: assistant });
    expect(workerMessagePayload({ role: "toolResult" })).toEqual({ type: "message_end" });
  });
});
