import type { Provider } from "@earendil-works/pi-ai";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { loadOpenAICodexProvider } from "./native-provider.ts";
import { createCodexSwitcherProvider } from "./provider.ts";

export const version = 1 as const;

type CreateProviderInput = {
  readonly providerId: string;
  readonly agentDir: string;
  readonly nativeProvider?: Provider;
  readonly signal?: AbortSignal;
};

export async function createProvider(input: CreateProviderInput) {
  input.signal?.throwIfAborted();
  if (input.providerId !== "openai-codex") {
    throw new Error(`Codex switcher cannot provide ${input.providerId}.`);
  }
  const nativeProvider = await loadOpenAICodexProvider();
  const runtime = createCodexSwitcherProvider({
    agentDir: input.agentDir,
    nativeProvider,
  });
  return {
    provider: runtime.provider,
    startRun: (runId: string) => {
      runtime.startRun(runId);
    },
    finishRun: (runId: string) => {
      runtime.finishRun(runId);
    },
    close: () => {
      runtime.close();
    },
  };
}

export default async function codexSwitcherProviderExtension(pi: ExtensionAPI): Promise<void> {
  const created = await createProvider({
    providerId: "openai-codex",
    agentDir: getAgentDir(),
  });
  pi.registerProvider(created.provider);
  const start = (): void => {
    created.startRun("pi-agent-run");
  };
  pi.on("before_agent_start", start);
  pi.on("agent_start", start);
  pi.on("agent_settled", () => {
    created.finishRun("pi-agent-run");
  });
  pi.on("session_shutdown", () => {
    created.close();
  });
}
