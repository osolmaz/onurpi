import { readFileSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { Provider } from "@earendil-works/pi-ai";

type CodexProvider = Provider<"openai-codex-responses">;

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isCodexProvider(value: unknown): value is CodexProvider {
  const provider = object(value);
  return (
    provider?.["id"] === "openai-codex" &&
    object(provider["auth"]) !== undefined &&
    typeof provider["getModels"] === "function" &&
    typeof provider["stream"] === "function" &&
    typeof provider["streamSimple"] === "function"
  );
}

function providerModuleUrl(): string {
  const packageJson = findPackageJSON("@earendil-works/pi-ai", import.meta.url);
  if (!packageJson) throw new Error("The installed pi-ai package could not be found.");
  const manifest: unknown = JSON.parse(readFileSync(packageJson, "utf8"));
  const exports = object(manifest)?.["exports"];
  const providerExport = object(exports)?.["./providers/*"];
  const target = object(providerExport)?.["import"];
  if (typeof target !== "string" || !target.includes("*")) {
    throw new Error("The installed pi-ai package does not publish provider subpaths.");
  }
  const root = dirname(packageJson);
  const path = resolve(root, target.replace("*", "openai-codex"));
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error("The installed pi-ai provider export resolves outside its package.");
  }
  return pathToFileURL(path).href;
}

/** Load a public pi-ai provider subpath without Pi's compatibility import redirect. */
export async function loadOpenAICodexProvider(): Promise<CodexProvider> {
  const loaded: unknown = await import(providerModuleUrl());
  const factory = object(loaded)?.["openaiCodexProvider"];
  if (typeof factory !== "function") {
    throw new Error("The installed pi-ai package does not export the OpenAI Codex provider.");
  }
  const provider: unknown = (factory as () => unknown)();
  if (!isCodexProvider(provider)) {
    throw new Error("The installed pi-ai OpenAI Codex provider has an incompatible shape.");
  }
  return provider;
}
