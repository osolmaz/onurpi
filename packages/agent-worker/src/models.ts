import type { Message, Models, UserMessage } from "@earendil-works/pi-ai";
import type { Provider } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai/providers/faux";
import { huggingfaceProvider } from "@earendil-works/pi-ai/providers/huggingface";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { ModelProvider, WorkerConfig } from "./config.ts";
import { openshellCodexCredentials } from "./openshell.ts";

function lastUserText(messages: readonly Message[]): string {
  const user = messages.findLast((message): message is UserMessage => message.role === "user");
  if (typeof user?.content !== "object") return user?.content ?? "";
  return user.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

/**
 * A model for development and tests that answers every message with `Echo: <message>`. It needs
 * no key and makes no network call.
 */
export function echoProvider(): ReturnType<typeof fauxProvider> {
  const echo = fauxProvider({ models: [{ id: "echo", name: "Echo" }], provider: "echo" });
  const answer: FauxResponseFactory = (context) => {
    echo.appendResponses([answer]);
    return fauxAssistantMessage(`Echo: ${lastUserText(context.messages)}`);
  };
  echo.setResponses([answer]);
  return echo;
}

const KEY_PROVIDERS = {
  anthropic: anthropicProvider,
  echo: () => echoProvider().provider,
  huggingface: huggingfaceProvider,
  openai: openaiProvider,
  "opencode-go": opencodeGoProvider,
  openrouter: openrouterProvider,
} as const satisfies Record<Exclude<ModelProvider, "openai-codex">, () => unknown>;

/**
 * The provider with every chat model's window capped at `ceiling`. The agent's compaction thresholds
 * and its context estimates are both measured against the window, so a cap here bounds the request
 * size wherever the window is read. `maxTokens` shrinks with it, so a capped model cannot reserve an
 * answer larger than its whole window.
 */
function cappedProvider<T extends Provider>(provider: T, ceiling: number | undefined): T {
  if (ceiling === undefined) return provider;
  return {
    ...provider,
    getModels: () => provider.getModels().map((model) => capModel(model, ceiling)),
    ...(provider.getAllModels === undefined
      ? {}
      : {
          getAllModels: () =>
            (provider.getAllModels?.() ?? []).map((model) => capModel(model, ceiling)),
        }),
  };
}

/** One model with its window lowered to `ceiling`, leaving models that already fit untouched. */
function capModel<M extends object>(model: M, ceiling: number): M {
  const sized = model as { readonly contextWindow?: number; readonly maxTokens?: number };
  if (sized.contextWindow === undefined || sized.contextWindow <= ceiling) return model;
  return sized.maxTokens === undefined
    ? { ...model, contextWindow: ceiling }
    : { ...model, contextWindow: ceiling, maxTokens: Math.min(sized.maxTokens, ceiling) };
}

/**
 * Models with the one configured provider. `openai-codex` uses the ChatGPT subscription of the
 * OpenShell provider attached to the sandbox. The other hosted providers read their key from the
 * environment. A `ceiling` caps every model's context window.
 */
export function workerModels(
  model: WorkerConfig["model"],
  env: NodeJS.ProcessEnv = process.env,
  ceiling?: number,
): Models {
  if (model.provider === "openai-codex") {
    const models = createModels({ credentials: openshellCodexCredentials(env) });
    models.setProvider(cappedProvider(openaiCodexProvider(), ceiling));
    return models;
  }
  const models = createModels();
  models.setProvider(cappedProvider(KEY_PROVIDERS[model.provider](), ceiling));
  return models;
}
