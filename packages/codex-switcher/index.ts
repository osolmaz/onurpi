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

export function installCodexSwitcher(
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
  const runtime = createCodexSwitcherProvider({
    agentDir,
    nativeProvider,
    configResult,
    ...(options.configPath === undefined ? {} : { configPath: options.configPath }),
    ...(options.vault === undefined ? {} : { vault: options.vault }),
    ...(options.vaultPath === undefined ? {} : { vaultPath: options.vaultPath }),
  });
  pi.registerProvider(runtime.provider);
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
  return runtime;
}

export function installCodexSwitcherStartup(
  pi: ExtensionAPI,
  runtime: CodexSwitcherProvider,
  options: Omit<StartupAuthAdapterOptions, "isReady"> = {},
): RestoreStartupAuthAdapter {
  const restore = installStartupAuthAdapter({
    ...options,
    isReady: runtime.isAuthenticationReady,
  });
  try {
    pi.on("session_start", restore);
    pi.on("session_shutdown", restore);
    return restore;
  } catch (error) {
    restore();
    throw error;
  }
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
  let runtime: CodexSwitcherProvider | undefined;
  try {
    const nativeProvider = await loadOpenAICodexProvider();
    runtime = installCodexSwitcher(pi, { nativeProvider });
    if (!runtime) return;
    installCodexSwitcherStartup(pi, runtime);
  } catch (error) {
    runtime?.close();
    throw error;
  }
}
