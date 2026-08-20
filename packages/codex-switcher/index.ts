import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { runAccountManager, type ConfigController } from "./account-manager.ts";
import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  type CodexSwitcherConfig,
  type ConfigLoadResult,
  writeCodexSwitcherConfig,
} from "./config.ts";
import { loadOpenAICodexProvider } from "./native-provider.ts";
import {
  createCodexSwitcherStream,
  type CodexTransport,
  type SwitcherRuntime,
  type SwitcherState,
} from "./router.ts";
import { createCodexUsageClient } from "./usage-client.ts";
import { minimumRemaining } from "./usage-policy.ts";
import { codexSwitcherVaultPath, createAccountVault, type AccountVault } from "./vault.ts";

const DEFAULT_REFRESH_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
type CodexModel = Model<"openai-codex-responses">;
type CodexProvider = Provider<"openai-codex-responses">;
type LiveContext = Pick<ExtensionContext, "model" | "ui">;

function emptyConfig(): CodexSwitcherConfig {
  return { accounts: [], refreshMs: DEFAULT_REFRESH_MS, timeoutMs: DEFAULT_TIMEOUT_MS };
}

function createConfigController(path: string, initial: CodexSwitcherConfig): ConfigController {
  let current = initial;
  return {
    get: () => current,
    replace: (config) => {
      writeCodexSwitcherConfig(path, config);
      current = config;
    },
  };
}

async function hasConfiguredAccount(
  config: CodexSwitcherConfig,
  vault: AccountVault,
): Promise<boolean> {
  const stored = new Set(await vault.list());
  return config.accounts.some((account) => stored.has(account.id));
}

async function resolveProviderAuth(
  config: CodexSwitcherConfig,
  vault: AccountVault,
  state: SwitcherState,
  signal: AbortSignal,
) {
  const preferred = [state.leaseAccountId, state.activeAccountId].filter(
    (id): id is string => id !== undefined,
  );
  const candidates = [...new Set([...preferred, ...config.accounts.map((account) => account.id)])];
  for (const id of candidates) {
    const auth = await vault.resolve(id, signal);
    if (auth) return { auth, source: "Codex switcher account vault" };
  }
  return undefined;
}

function statusText(state: SwitcherState): string | undefined {
  const id = state.activeAccountId;
  if (!id) return undefined;
  const usage = state.usageByAccount.get(id);
  if (usage?.status === "ready") {
    const remaining = minimumRemaining(usage.report);
    if (remaining !== undefined) return `${id} ${Math.max(0, remaining).toFixed(0)}%`;
  }
  return id;
}

function setStatus(context: LiveContext | undefined, state: SwitcherState): void {
  context?.ui.setStatus("codex-switcher", statusText(state));
}

function createSwitcherProvider(
  native: CodexProvider,
  config: ConfigController,
  vault: AccountVault,
  state: SwitcherState,
  stream: CodexTransport,
  streamSimple: CodexTransport,
): CodexProvider {
  return createProvider({
    id: native.id,
    name: native.name,
    ...(native.baseUrl ? { baseUrl: native.baseUrl } : {}),
    ...(native.headers ? { headers: native.headers } : {}),
    auth: {
      apiKey: {
        name: "Codex switcher account vault",
        check: async () =>
          (await hasConfiguredAccount(config.get(), vault))
            ? { type: "oauth", source: "Codex switcher account vault" }
            : undefined,
        resolve: ({ signal }) => resolveProviderAuth(config.get(), vault, state, signal),
      },
    },
    models: native.getModels(),
    api: {
      stream: (model, context, options) => stream(model as CodexModel, context, options),
      streamSimple: (model, context, options) =>
        streamSimple(model as CodexModel, context, options),
    },
  });
}

function registerLifecycle(
  pi: ExtensionAPI,
  state: SwitcherState,
  live: { context: LiveContext | undefined },
): void {
  const startAgentRun = (context: LiveContext): void => {
    live.context = context;
    if (!state.agentRunActive) {
      state.agentRunActive = true;
      state.leaseAccountId = undefined;
      state.activeAccountId = undefined;
    }
    setStatus(context, state);
  };

  pi.on("session_start", (_event, context) => {
    live.context = context;
    setStatus(live.context, state);
  });
  pi.on("model_select", (event, context) => {
    live.context = context;
    if (event.model.provider !== "openai-codex") {
      context.ui.setStatus("codex-switcher", undefined);
    } else {
      setStatus(context, state);
    }
  });
  pi.on("before_agent_start", (_event, context) => {
    startAgentRun(context);
  });
  pi.on("agent_start", (_event, context) => {
    startAgentRun(context);
  });
  pi.on("agent_settled", (_event, context) => {
    live.context = context;
    state.agentRunActive = false;
    state.leaseAccountId = undefined;
    setStatus(context, state);
  });
  pi.on("session_shutdown", (_event, context) => {
    context.ui.setStatus("codex-switcher", undefined);
    state.agentRunActive = false;
    state.leaseAccountId = undefined;
    state.activeAccountId = undefined;
    live.context = undefined;
  });
}

export type InstallOptions = {
  configPath?: string;
  configResult?: ConfigLoadResult;
  nativeProvider?: CodexProvider;
  vault?: AccountVault;
  vaultPath?: string;
};

function requiredNativeProvider(options: InstallOptions): {
  native: CodexProvider;
  oauth: NonNullable<CodexProvider["auth"]["oauth"]>;
} {
  const native = options.nativeProvider;
  const oauth = native?.auth.oauth;
  if (!native || !oauth) {
    throw new Error("Codex switcher requires the built-in OpenAI Codex OAuth provider.");
  }
  return { native, oauth };
}

function configuredVault(
  options: InstallOptions,
  oauth: NonNullable<CodexProvider["auth"]["oauth"]>,
): AccountVault {
  if (options.vault) return options.vault;
  return createAccountVault(options.vaultPath ?? codexSwitcherVaultPath(getAgentDir()), oauth);
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

export function installCodexSwitcher(pi: ExtensionAPI, options: InstallOptions): void {
  const configPath = options.configPath ?? codexSwitcherConfigPath(getAgentDir());
  const result = options.configResult ?? loadCodexSwitcherConfig(configPath);
  if (result.status === "invalid") {
    registerInvalidConfigCommand(pi, result);
    return;
  }

  const { native, oauth } = requiredNativeProvider(options);
  const config = createConfigController(
    configPath,
    result.status === "ready" ? result.config : emptyConfig(),
  );
  const vault = configuredVault(options, oauth);
  const state: SwitcherState = {
    activeAccountId: undefined,
    agentRunActive: false,
    leaseAccountId: undefined,
    usageByAccount: new Map(),
  };
  const live: { context: LiveContext | undefined } = { context: undefined };
  const usage = createCodexUsageClient(config.get().refreshMs, config.get().timeoutMs);
  const runtime: SwitcherRuntime = {
    getAuth: (accountId, signal) => vault.resolve(accountId, signal),
    queryUsage: (account, auth, model, signal) => usage.query(account, auth, model, signal),
    clearUsage: (account) => {
      usage.clear(account);
    },
    activateAccount: (account) => {
      state.activeAccountId = account.id;
      setStatus(live.context, state);
    },
  };
  const routerOptions = {
    getAccounts: () => config.get().accounts,
    runtime,
    state,
  };
  const stream = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, context, streamOptions) => native.stream(model, context, streamOptions),
  });
  const streamSimple = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, context, streamOptions) =>
      native.streamSimple(model, context, streamOptions),
  });

  pi.registerProvider(createSwitcherProvider(native, config, vault, state, stream, streamSimple));
  pi.registerCommand("codex-switcher", {
    description: "Manage OpenAI Codex accounts, billing, order, and usage",
    handler: (args, context) =>
      runAccountManager(args, context, {
        config,
        oauth,
        pi,
        state,
        vault,
      }),
  });
  registerLifecycle(pi, state, live);
}

export default async function codexSwitcherExtension(pi: ExtensionAPI): Promise<void> {
  const nativeProvider = await loadOpenAICodexProvider();
  installCodexSwitcher(pi, { nativeProvider });
}
