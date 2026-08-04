import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalModelsStorePath,
  registerHuggingFaceOAuthProvider,
} from "../src/huggingface-provider.js";

const cleanup: string[] = [];

const KIMI_ROUTE_MODEL = {
  id: "moonshotai/Kimi-K3:fireworks-ai",
  name: "Kimi K3 (fireworks-ai)",
  provider: "huggingface",
  api: "openai-completions",
  baseUrl: "https://router.huggingface.co/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 262_144,
  maxTokens: 32_768,
};

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true })));
});

async function canonicalFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-reviewer-hf-"));
  cleanup.push(root);
  const agentDir = path.join(root, "agent");
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    path.join(agentDir, "auth.json"),
    JSON.stringify({
      huggingface: {
        type: "oauth",
        access: "test-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() + 3_600_000,
      },
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(agentDir, "models-store.json"),
    JSON.stringify({
      huggingface: {
        checkedAt: Date.now(),
        lastModified: Date.now(),
        models: [{ ...KIMI_ROUTE_MODEL, name: "Kimi K3 (fireworks-ai)" }],
      },
    }),
  );
  return agentDir;
}

describe("review Hugging Face provider", () => {
  it("derives the canonical model store path from the auth path", () => {
    expect(canonicalModelsStorePath("/home/user/.pi/agent/auth.json")).toBe(
      path.join("/home/user/.pi/agent", "models-store.json"),
    );
  });

  it("registers Hugging Face OAuth with the canonical credential and model store", async () => {
    const agentDir = await canonicalFixture();
    const modelsDir = path.join(agentDir, "reviewer-models");
    await mkdir(modelsDir, { recursive: true });
    await writeFile(path.join(modelsDir, "models.json"), JSON.stringify({ providers: {} }));
    const authPath = path.join(agentDir, "auth.json");
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: path.join(modelsDir, "models.json"),
      modelsStorePath: canonicalModelsStorePath(authPath),
      allowModelNetwork: false,
    });

    await registerHuggingFaceOAuthProvider(runtime);

    expect(await runtime.checkAuth("huggingface")).toBeTruthy();
    const model = runtime.getModel("huggingface", "moonshotai/Kimi-K3:fireworks-ai");
    expect(model?.id).toBe("moonshotai/Kimi-K3:fireworks-ai");
    const available = await runtime.getAvailable("huggingface");
    expect(available.some((entry) => entry.id === "moonshotai/Kimi-K3:fireworks-ai")).toBe(true);
  });

  it("registers the provider in the login runtime factory", async () => {
    const agentDir = await canonicalFixture();
    const modelsDir = path.join(agentDir, "reviewer-models");
    await mkdir(modelsDir, { recursive: true });
    await writeFile(path.join(modelsDir, "models.json"), JSON.stringify({ providers: {} }));
    const authPath = path.join(agentDir, "auth.json");
    const { defaultRuntimeFactory } = await import("../src/auth.js");
    const runtime = await defaultRuntimeFactory({
      authPath,
      modelsPath: path.join(modelsDir, "models.json"),
    });

    const huggingface = runtime.getProviders().find((provider) => provider.id === "huggingface");

    expect(huggingface?.auth.oauth).toBeDefined();
  });

  it("passes a valid provider configuration", async () => {
    const agentDir = await canonicalFixture();
    const authPath = path.join(agentDir, "auth.json");
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: null,
      modelsStorePath: canonicalModelsStorePath(authPath),
      allowModelNetwork: false,
    });

    const register = vi.spyOn(runtime, "registerProvider");
    await registerHuggingFaceOAuthProvider(runtime);

    expect(register).toHaveBeenCalledTimes(1);
    const call = register.mock.calls[0];
    expect(call?.[0]).toBe("huggingface");
    expect(call?.[1].oauth?.name).toBe("Hugging Face Inference Providers");
    expect(typeof call?.[1].refreshModels).toBe("function");
  });
});
