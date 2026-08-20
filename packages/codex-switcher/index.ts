import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { runAccountManager } from "./account-manager.ts";
import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  type ConfigLoadResult,
} from "./config.ts";
import { loadOpenAICodexProvider } from "./native-provider.ts";
import {
  createCodexSwitcherProvider,
  type CodexProvider,
  type CodexSwitcherProvider,
} from "./provider.ts";
import {
  installStartupAuthAdapter,
  type RestoreStartupAuthAdapter,
  type StartupAuthAdapterOptions,
} from "./startup-auth-adapter.ts";
import type { AccountVault } from "./vault.ts";

export type InstallOptions = {
  readonly configPath?: string;
  readonly configResult?: ConfigLoadResult;
  readonly nativeProvider?: CodexProvider;
  readonly vault?: AccountVault;
  readonly vaultPath?: string;
};

type StartupOptions = Omit<StartupAuthAdapterOptions, "isReady">;

export function installCodexSwitcher(
  pi: ExtensionAPI,
  options: InstallOptions,
): CodexSwitcherProvider | undefined {
  const runtime = createCodexSwitcher(pi, options);
  if (!runtime) return;
  registerCodexSwitcher(pi, runtime);
  return runtime;
}

export function installCodexSwitcherExtension(
  pi: ExtensionAPI,
  options: InstallOptions,
  startupOptions: StartupOptions = {},
): CodexSwitcherProvider | undefined {
  let runtime: CodexSwitcherProvider | undefined;
  let restoreStartup: RestoreStartupAuthAdapter | undefined;
  try {
    runtime = createCodexSwitcher(pi, options);
    if (!runtime) return;
    restoreStartup = installCodexSwitcherStartup(pi, runtime, startupOptions);
    registerCodexSwitcher(pi, runtime);
    return runtime;
  } catch (error) {
    restoreStartup?.();
    runtime?.close();
    throw error;
  }
}

function createCodexSwitcher(
  pi: ExtensionAPI,
  options: InstallOptions,
): CodexSwitcherProvider | undefined {
  const agentDir = getAgentDir();
  const configResult =
    options.configResult ??
    loadCodexSwitcherConfig(options.configPath ?? codexSwitcherConfigPath(agentDir));
  if (configResult.status === "invalid") {
    registerInvalidConfigCommand(pi, configResult);
    return;
  }
  const nativeProvider = options.nativeProvider;
  if (!nativeProvider) {
    throw new Error("Codex switcher requires the built-in OpenAI Codex OAuth provider.");
  }
  return createCodexSwitcherProvider({
    agentDir,
    nativeProvider,
    configResult,
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.vault === undefined ? {} : { vault: options.vault }),
    ...(options.vaultPath === undefined ? {} : { vaultPath: options.vaultPath }),
  });
}

function registerCodexSwitcher(pi: ExtensionAPI, runtime: CodexSwitcherProvider): void {
  pi.registerCommand("codex-switcher", {
    description: "Manage OpenAI Codex accounts, billing, order, and usage",
    handler: (args, context) =>
      runAccountManager(args, context, {
        config: runtime.config,
        oauth: runtime.oauth,
        pi,
        state: runtime.state,
        vault: runtime.vault,
      }),
  });
  registerLifecycle(pi, runtime);
  pi.registerProvider(runtime.provider);
}

export function installCodexSwitcherStartup(
  pi: ExtensionAPI,
  runtime: CodexSwitcherProvider,
  options: StartupOptions = {},
): RestoreStartupAuthAdapter {
  const restoreAuth = installStartupAuthAdapter({
    ...options,
    isReady: runtime.isAuthenticationReady,
  });
  let restoreProvider: RestoreStartupAuthAdapter | undefined;
  let active = true;
  const restore = (): void => {
    if (!active) return;
    active = false;
    restoreProvider?.();
    restoreAuth();
  };
  try {
    restoreProvider = restoreWhenProviderBinds(runtime.provider, restore);
    pi.on("session_start", restore);
    pi.on("session_shutdown", restore);
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
}

function restoreWhenProviderBinds(
  provider: CodexProvider,
  restore: RestoreStartupAuthAdapter,
): RestoreStartupAuthAdapter {
  const original = Reflect.get(provider, "getModels");
  let active = true;
  const wrapped: CodexProvider["getModels"] = function (this: CodexProvider) {
    cleanup();
    restore();
    return Reflect.apply(original, this, []);
  };
  if (!Reflect.set(provider, "getModels", wrapped)) {
    throw new Error("Unable to observe Codex provider registration during session startup.");
  }

  function cleanup(): void {
    if (!active) return;
    active = false;
    if (Reflect.get(provider, "getModels") === wrapped) {
      Reflect.set(provider, "getModels", original);
    }
  }
  return cleanup;
}

function registerLifecycle(pi: ExtensionAPI, runtime: CodexSwitcherProvider): void {
  pi.on("session_start", (_event, context) => {
    context.ui.setStatus("codex-switcher", undefined);
  });
  pi.on("before_agent_start", () => {
    runtime.startRun();
  });
  pi.on("agent_start", () => {
    runtime.startRun();
  });
  pi.on("agent_settled", () => {
    runtime.finishRun();
  });
  pi.on("session_shutdown", (_event, context) => {
    context.ui.setStatus("codex-switcher", undefined);
    runtime.close();
  });
}

function registerInvalidConfigCommand(
  pi: ExtensionAPI,
  result: Extract<ConfigLoadResult, { status: "invalid" }>,
): void {
  pi.registerCommand("codex-switcher", {
    description: "Manage OpenAI Codex accounts",
    handler: (_args, context) => {
      context.ui.notify(`Codex switcher configuration is invalid: ${result.message}`, "error");
      return Promise.resolve();
    },
  });
}

export default async function codexSwitcherExtension(pi: ExtensionAPI): Promise<void> {
  const nativeProvider = await loadOpenAICodexProvider();
  installCodexSwitcherExtension(pi, { nativeProvider });
}
