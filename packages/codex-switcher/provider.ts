import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";

import type { ConfigController } from "./account-manager.ts";
import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  type CodexSwitcherConfig,
  type ConfigLoadResult,
  writeCodexSwitcherConfig,
} from "./config.ts";
import {
  createCodexSwitcherStream,
  type CodexTransport,
  type SwitcherRuntime,
  type SwitcherState,
} from "./router.ts";
import { createCodexUsageClient } from "./usage-client.ts";
import { codexSwitcherVaultPath, createAccountVault, type AccountVault } from "./vault.ts";

const DEFAULT_REFRESH_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
type CodexModel = Model<"openai-codex-responses">;
export type CodexProvider = Provider<"openai-codex-responses">;

export type CodexSwitcherProvider = {
  readonly provider: CodexProvider;
  readonly config: ConfigController;
  readonly oauth: NonNullable<CodexProvider["auth"]["oauth"]>;
  readonly state: SwitcherState;
  readonly vault: AccountVault;
  readonly isAuthenticationReady: () => boolean;
  readonly startRun: (runId?: string) => void;
  readonly finishRun: (runId?: string) => void;
  readonly close: () => void;
};

export type CreateCodexSwitcherProviderOptions = {
  readonly agentDir: string;
  readonly nativeProvider: CodexProvider;
  readonly configPath?: string;
  readonly configResult?: Exclude<ConfigLoadResult, { status: "invalid" }>;
  readonly vault?: AccountVault;
  readonly vaultPath?: string;
};

export function createCodexSwitcherProvider(
  options: CreateCodexSwitcherProviderOptions,
): CodexSwitcherProvider {
  const oauth = options.nativeProvider.auth.oauth;
  if (!oauth) throw new Error("Codex switcher requires the built-in OpenAI Codex OAuth provider.");
  const configPath = options.configPath ?? codexSwitcherConfigPath(options.agentDir);
  const result = options.configResult ?? loadCodexSwitcherConfig(configPath);
  if (result.status === "invalid") {
    throw new Error(`Codex switcher configuration is invalid: ${result.message}`);
  }
  const config = createConfigController(
    configPath,
    result.status === "ready" ? result.config : emptyConfig(),
  );
  const vault =
    options.vault ??
    createAccountVault(options.vaultPath ?? codexSwitcherVaultPath(options.agentDir), oauth);
  const state: SwitcherState = {
    activeAccountId: undefined,
    agentRunActive: false,
    leaseAccountId: undefined,
    usageByAccount: new Map(),
  };
  const usage = createCodexUsageClient(config.get().refreshMs, config.get().timeoutMs);
  const runtime: SwitcherRuntime = {
    getAuth: (accountId, signal) => vault.resolve(accountId, signal),
    queryUsage: (account, auth, model, signal) => usage.query(account, auth, model, signal),
    clearUsage: (account) => {
      usage.clear(account);
    },
    activateAccount: (account) => {
      state.activeAccountId = account.id;
    },
  };
  const routerOptions = {
    getAccounts: () => config.get().accounts,
    runtime,
    state,
  };
  const stream = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, context, streamOptions) =>
      options.nativeProvider.stream(model, context, streamOptions),
  });
  const streamSimple = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, context, streamOptions) =>
      options.nativeProvider.streamSimple(model, context, streamOptions),
  });
  const startRun = (): void => {
    if (state.agentRunActive) return;
    state.agentRunActive = true;
    state.leaseAccountId = undefined;
    state.activeAccountId = undefined;
  };
  const finishRun = (): void => {
    state.agentRunActive = false;
    state.leaseAccountId = undefined;
  };
  const close = (): void => {
    finishRun();
    state.activeAccountId = undefined;
  };
  return {
    provider: switcherProvider(options.nativeProvider, config, vault, state, stream, streamSimple),
    config,
    oauth,
    state,
    vault,
    isAuthenticationReady: () =>
      vault.hasAnySync(config.get().accounts.map((account) => account.id)),
    startRun,
    finishRun,
    close,
  };
}

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

function switcherProvider(
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
      stream: (model, context, streamOptions) =>
        stream(model as CodexModel, context, streamOptions),
      streamSimple: (model, context, streamOptions) =>
        streamSimple(model as CodexModel, context, streamOptions),
    },
  });
}
