import { hasApi, lazyStream, type Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";

import {
  resolveCodexCliCredential,
  type CredentialResolution,
  type ProviderHeaders,
} from "./credential-source.ts";

type CodexModel = Model<"openai-codex-responses">;
type CodexStreamSimple = NonNullable<ProviderConfig["streamSimple"]>;

type CodexRequestOptions = {
  apiKey?: string;
  headers?: ProviderHeaders;
};

type ResolveCredential = (options: {
  apiKey?: string;
  headers: ProviderHeaders;
}) => Promise<CredentialResolution>;

export function isOfficialCodexEndpoint(model: Pick<CodexModel, "baseUrl">): boolean {
  try {
    const url = new URL(model.baseUrl);
    const path = url.pathname.replace(/\/+$/u, "");
    return (
      url.origin === "https://chatgpt.com" &&
      path === "/backend-api" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export async function reloadCodexRequestOptions<T extends CodexRequestOptions>(
  model: Pick<CodexModel, "baseUrl">,
  options: T | undefined,
  resolveCredential: ResolveCredential = resolveCodexCliCredential,
): Promise<T | undefined> {
  if (!options || !isOfficialCodexEndpoint(model)) return options;
  const resolution = await resolveCredential({
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    headers: options.headers ?? {},
  });
  return resolution.status === "replace"
    ? { ...options, apiKey: resolution.credential.accessToken }
    : options;
}

function builtInCodexStream(): CodexStreamSimple {
  return (model, context, options) => {
    const provider = getApiProvider(model.api);
    if (!provider) throw new Error(`No API provider registered for ${model.api}.`);
    return provider.streamSimple(model, context, options);
  };
}

export function createCodexAuthReloadStream(
  stream: CodexStreamSimple = builtInCodexStream(),
  resolveCredential: ResolveCredential = resolveCodexCliCredential,
): NonNullable<ProviderConfig["streamSimple"]> {
  return (model, context, streamOptions) =>
    lazyStream(model, async () => {
      if (!hasApi(model, "openai-codex-responses")) {
        throw new Error(`OpenAI Codex cannot stream API type "${model.api}".`);
      }
      return stream(
        model,
        context,
        await reloadCodexRequestOptions(model, streamOptions, resolveCredential),
      );
    });
}

export default function codexAuthReloadExtension(pi: ExtensionAPI): void {
  pi.registerProvider("openai-codex", {
    api: "openai-codex-responses",
    streamSimple: createCodexAuthReloadStream(),
  });
}
