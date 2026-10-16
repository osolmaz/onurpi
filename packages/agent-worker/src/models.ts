import type { Message, Models, UserMessage } from "@earendil-works/pi-ai";
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
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createProvider } from "@onurpi/codex-switcher/provider";
import type { ModelProvider, WorkerConfig } from "./config.ts";

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

export type WorkerModels = {
  readonly models: Models;
  /** Releases what the provider holds, such as the Codex account router. */
  close(): void;
};

const KEY_PROVIDERS = {
  anthropic: anthropicProvider,
  echo: () => echoProvider().provider,
  huggingface: huggingfaceProvider,
  openai: openaiProvider,
  openrouter: openrouterProvider,
} as const satisfies Record<Exclude<ModelProvider, "openai-codex">, () => unknown>;

/**
 * Models with the one configured provider. `openai-codex` uses the ChatGPT subscription through
 * the codex-switcher provider, which reads the logins in the Pi agent folder in place, with the
 * same lock and account order as Pi. The other hosted providers read their key from the
 * environment.
 */
export function workerModels(model: WorkerConfig["model"]): WorkerModels {
  const models = createModels();
  if (model.provider !== "openai-codex") {
    models.setProvider(KEY_PROVIDERS[model.provider]());
    return { close: () => undefined, models };
  }
  const codex = createProvider({
    agentDir: model.agentDir,
    nativeProvider: openaiCodexProvider(),
    providerId: "openai-codex",
  });
  models.setProvider(codex.provider);
  return { close: codex.close, models };
}
