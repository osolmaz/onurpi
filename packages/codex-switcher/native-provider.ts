import type { Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

type CodexProvider = Provider<"openai-codex-responses">;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function isOpenAICodexProvider(value: unknown): value is CodexProvider {
  const provider = object(value);
  return (
    provider?.["id"] === "openai-codex" &&
    object(provider["auth"]) !== undefined &&
    typeof provider["getModels"] === "function" &&
    typeof provider["stream"] === "function" &&
    typeof provider["streamSimple"] === "function"
  );
}

/** Load the public provider through Pi's compatibility-resolved pi-ai package. */
export function loadOpenAICodexProvider(): Promise<CodexProvider> {
  const provider: unknown = builtinProviders().find((candidate) => candidate.id === "openai-codex");
  if (!isOpenAICodexProvider(provider)) {
    throw new Error("The installed pi-ai OpenAI Codex provider has an incompatible shape.");
  }
  return Promise.resolve(provider);
}
