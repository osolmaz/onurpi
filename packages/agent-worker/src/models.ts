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
 * Models with the one configured provider. `openai-codex` uses the ChatGPT subscription of the
 * OpenShell provider attached to the sandbox. The other hosted providers read their key from the
 * environment.
 */
export function workerModels(
  model: WorkerConfig["model"],
  env: NodeJS.ProcessEnv = process.env,
): Models {
  if (model.provider === "openai-codex") {
    const models = createModels({ credentials: openshellCodexCredentials(env) });
    models.setProvider(openaiCodexProvider());
    return models;
  }
  const models = createModels();
  models.setProvider(KEY_PROVIDERS[model.provider]());
  return models;
}
