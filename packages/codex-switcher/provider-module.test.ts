import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import providerExtension, { createProvider, version } from "./provider-module.ts";
import { loadOpenAICodexProvider } from "./native-provider.ts";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Pi Factory provider module", () => {
  it("loads the official provider instead of trusting an injected provider", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "codex-provider-module-"));
    try {
      const nativeProvider = await loadOpenAICodexProvider();
      const injectedProvider: Provider = {
        ...nativeProvider,
        getModels: () => [],
      };
      const created = await createProvider({
        providerId: "openai-codex",
        agentDir,
        nativeProvider: injectedProvider,
      });
      expect(version).toBe(1);
      expect(created.provider.id).toBe("openai-codex");
      expect(created.provider.getModels().map((model) => model.id)).toEqual(
        nativeProvider.getModels().map((model) => model.id),
      );
      created.startRun("review");
      created.finishRun("review");
      created.close();
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("registers only the provider and lifecycle in extension mode", async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), "codex-provider-extension-"));
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    const providers: Provider[] = [];
    const commands: string[] = [];
    const events: string[] = [];
    const api = {
      registerProvider: (provider: Provider) => providers.push(provider),
      registerCommand: (name: string) => commands.push(name),
      on: (event: string) => {
        events.push(event);
      },
    } as unknown as ExtensionAPI;
    try {
      await providerExtension(api);
      expect(providers.map((provider) => provider.id)).toEqual(["openai-codex"]);
      expect(commands).toEqual([]);
      expect(events).toEqual([
        "before_agent_start",
        "agent_start",
        "agent_settled",
        "session_shutdown",
      ]);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
