import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@earendil-works/pi-ai";

export const CODEX_PROVIDER_ID = "openai-codex";
export const CODEX_PROFILE_PREFIX = `${CODEX_PROVIDER_ID}-`;
export const CODEX_API = "openai-codex-responses";
export const OFFICIAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

type CodexModel = Model<"openai-codex-responses">;

export function isCodexProfileProvider(provider: string | undefined): boolean {
  return (
    provider?.startsWith(CODEX_PROFILE_PREFIX) === true &&
    provider.length > CODEX_PROFILE_PREFIX.length
  );
}

export function isCodexFamilyProvider(provider: string | undefined): boolean {
  return provider === CODEX_PROVIDER_ID || isCodexProfileProvider(provider);
}

export function isCodexFamilyModel(
  model: { provider?: unknown; api?: unknown } | undefined,
): boolean {
  return (
    model?.api === CODEX_API &&
    typeof model.provider === "string" &&
    isCodexFamilyProvider(model.provider)
  );
}

export function assertOfficialCodexEndpoint(model: Pick<CodexModel, "baseUrl">): void {
  try {
    const url = new URL(model.baseUrl);
    const path = url.pathname.replace(/\/+$/u, "");
    if (
      url.origin === "https://chatgpt.com" &&
      path === "/backend-api" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    ) {
      return;
    }
  } catch {
    // Report every malformed or non-official endpoint with the same safe message.
  }
  throw new Error(`Codex profile authentication is restricted to ${OFFICIAL_CODEX_BASE_URL}.`);
}

export function toBuiltInCodexModel(model: CodexModel): CodexModel {
  return { ...model, provider: CODEX_PROVIDER_ID };
}

function mapAssistantProvider(message: AssistantMessage, provider: string): AssistantMessage {
  return { ...message, provider };
}

export function toBuiltInCodexContext(context: Context): Context {
  return {
    ...context,
    messages: context.messages.map((message) =>
      message.role === "assistant" && isCodexFamilyProvider(message.provider)
        ? mapAssistantProvider(message, CODEX_PROVIDER_ID)
        : message,
    ),
  };
}

export function mapCodexEventProvider(
  event: AssistantMessageEvent,
  provider: string,
): AssistantMessageEvent {
  if (event.type === "done") {
    return { ...event, message: mapAssistantProvider(event.message, provider) };
  }
  if (event.type === "error") {
    return { ...event, error: mapAssistantProvider(event.error, provider) };
  }
  return { ...event, partial: mapAssistantProvider(event.partial, provider) };
}
