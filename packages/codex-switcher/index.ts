import { createProvider, type Model, type Provider } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import {
  codexSwitcherConfigPath,
  loadCodexSwitcherConfig,
  type CodexProfile,
  type CodexSwitcherConfig,
  type ConfigLoadResult,
} from "./config.ts";
import { loadOpenAICodexProvider } from "./native-provider.ts";
import {
  createCodexSwitcherStream,
  type CodexTransport,
  type ProfileUsageState,
  type SwitcherRuntime,
  type SwitcherState,
} from "./router.ts";
import { createCodexUsageClient } from "./usage-client.ts";
import { minimumRemaining } from "./usage-policy.ts";

type CodexModel = Model<"openai-codex-responses">;

type LiveContext = Pick<ExtensionContext, "model" | "modelRegistry" | "ui">;

function profileForProvider(
  config: CodexSwitcherConfig,
  provider: string | undefined,
): CodexProfile | undefined {
  return config.profiles.find((profile) => profile.providerId === provider);
}

function statusText(profile: CodexProfile, usage: ProfileUsageState | undefined): string {
  if (usage?.status === "ready") {
    const remaining = minimumRemaining(usage.report);
    if (remaining !== undefined) return `${profile.label} ${Math.max(0, remaining).toFixed(0)}%`;
  }
  return profile.label;
}

function setProfileStatus(
  context: LiveContext | undefined,
  state: SwitcherState,
  profile: CodexProfile | undefined,
): void {
  if (!context) return;
  if (!profile) {
    context.ui.setStatus("codex-switcher", undefined);
    return;
  }
  state.activeProfileId = profile.id;
  context.ui.setStatus("codex-switcher", statusText(profile, state.usageByProfile.get(profile.id)));
}

function authStatus(profile: CodexProfile, context: LiveContext | undefined): string {
  const configured = context?.modelRegistry.getProviderAuthStatus(profile.providerId).configured;
  if (configured === undefined) return "unknown auth";
  return configured ? "authenticated" : "not authenticated";
}

function usageStatus(profile: CodexProfile, state: SwitcherState): string {
  const usage = state.usageByProfile.get(profile.id);
  if (usage?.status === "failed") return `usage check failed: ${usage.message}`;
  if (usage?.status === "ready") {
    const remaining = minimumRemaining(usage.report);
    return remaining === undefined
      ? "usage available"
      : `${Math.max(0, remaining).toFixed(0)}% remaining`;
  }
  return "usage unknown";
}

function diagnosticLine(
  profile: CodexProfile,
  context: LiveContext | undefined,
  state: SwitcherState,
): string {
  const auth = authStatus(profile, context);
  const usageText = usageStatus(profile, state);
  const active = state.activeProfileId === profile.id ? ", active" : "";
  return `${profile.label} (${profile.providerId}): ${auth}, ${profile.billing}, ${usageText}${active}`;
}

function registerDiagnosticCommand(
  pi: ExtensionAPI,
  path: string,
  result: ConfigLoadResult,
  context: () => LiveContext | undefined,
  state: SwitcherState,
): void {
  pi.registerCommand("codex-switcher", {
    description: "Show Codex profile, authentication, and usage state",
    handler: (_args, commandContext) => {
      if (result.status === "missing") {
        commandContext.ui.notify(`Codex switcher configuration is missing: ${path}`, "warning");
        return Promise.resolve();
      }
      if (result.status === "invalid") {
        commandContext.ui.notify(
          `Codex switcher configuration is invalid: ${result.message}`,
          "error",
        );
        return Promise.resolve();
      }
      const lines = result.config.fallbackChain.map((id) => {
        const profile = result.config.profiles.find((candidate) => candidate.id === id);
        return profile ? diagnosticLine(profile, context(), state) : id;
      });
      commandContext.ui.notify(`Codex fallback chain:\n${lines.join("\n")}`, "info");
      return Promise.resolve();
    },
  });
}

function aliasModels(
  native: Provider<"openai-codex-responses">,
  profile: CodexProfile,
): CodexModel[] {
  return native.getModels().map((model) => ({
    ...model,
    provider: profile.providerId,
  }));
}

function createProfileProvider(
  native: Provider<"openai-codex-responses">,
  profile: CodexProfile,
  stream: CodexTransport,
  streamSimple: CodexTransport,
): Provider<"openai-codex-responses"> {
  return createProvider({
    id: profile.providerId,
    name: `OpenAI Codex (${profile.label})`,
    ...(native.baseUrl ? { baseUrl: native.baseUrl } : {}),
    auth: native.auth,
    models: aliasModels(native, profile),
    api: {
      stream: (model, context, options) => stream(model as CodexModel, context, options),
      streamSimple: (model, context, options) =>
        streamSimple(model as CodexModel, context, options),
    },
  });
}

function sameModel(left: CodexModel | undefined, right: CodexModel): boolean {
  return left?.provider === right.provider && left.id === right.id;
}

type LiveState = {
  context: LiveContext | undefined;
  preferredModel: CodexModel | undefined;
  internalModelChange: boolean;
};

async function selectInternalModel(
  pi: ExtensionAPI,
  live: LiveState,
  model: CodexModel,
): Promise<boolean> {
  live.internalModelChange = true;
  try {
    return await pi.setModel(model);
  } finally {
    live.internalModelChange = false;
  }
}

function registerLifecycle(
  pi: ExtensionAPI,
  config: CodexSwitcherConfig,
  state: SwitcherState,
  live: LiveState,
): void {
  pi.on("session_start", (_event, next) => {
    live.context = next;
    const profile = profileForProvider(config, next.model?.provider);
    live.preferredModel = profile ? (next.model as CodexModel) : undefined;
    setProfileStatus(live.context, state, profile);
  });
  pi.on("model_select", (event, next) => {
    live.context = next;
    const profile = profileForProvider(config, event.model.provider);
    if (!live.internalModelChange) {
      live.preferredModel = profile ? (event.model as CodexModel) : undefined;
      state.runProfileId = undefined;
    }
    setProfileStatus(live.context, state, profile);
  });
  pi.on("agent_start", () => {
    if (state.agentRunActive) return;
    state.agentRunActive = true;
    state.runProfileId = undefined;
  });
  pi.on("agent_settled", async (_event, next) => {
    state.agentRunActive = false;
    state.runProfileId = undefined;
    const preferred = live.preferredModel;
    if (!preferred || sameModel(next.model as CodexModel | undefined, preferred)) return;
    if (!(await selectInternalModel(pi, live, preferred))) {
      next.ui.notify("Codex switcher could not restore the preferred profile.", "warning");
    }
  });
  pi.on("session_shutdown", (_event, next) => {
    next.ui.setStatus("codex-switcher", undefined);
    state.agentRunActive = false;
    state.runProfileId = undefined;
    live.preferredModel = undefined;
    live.context = undefined;
  });
}

export type InstallOptions = {
  configPath?: string;
  configResult?: ConfigLoadResult;
  nativeProvider?: Provider<"openai-codex-responses">;
};

export function installCodexSwitcher(pi: ExtensionAPI, options: InstallOptions = {}): void {
  const path = options.configPath ?? codexSwitcherConfigPath(getAgentDir());
  const result = options.configResult ?? loadCodexSwitcherConfig(path);
  const state: SwitcherState = {
    agentRunActive: false,
    runProfileId: undefined,
    usageByProfile: new Map(),
  };
  const live: LiveState = {
    context: undefined,
    preferredModel: undefined,
    internalModelChange: false,
  };
  registerDiagnosticCommand(pi, path, result, () => live.context, state);
  if (result.status !== "ready") return;

  const config = result.config;
  const native = options.nativeProvider;
  if (!native) throw new Error("Codex switcher requires the built-in OpenAI Codex provider.");
  const usage = createCodexUsageClient(config.refreshMs, config.timeoutMs);
  const runtime: SwitcherRuntime = {
    getAuth: async (providerId) => {
      if (!live.context) throw new Error("Codex switcher runtime is not ready.");
      return live.context.modelRegistry.getProviderAuth(providerId);
    },
    queryUsage: (profile, auth, model, signal) => usage.query(profile, auth, model, signal),
    clearUsage: (profile) => {
      usage.clear(profile);
    },
    activateProfile: async (profile, model) => {
      setProfileStatus(live.context, state, profile);
      if (
        !state.agentRunActive ||
        sameModel(live.context?.model as CodexModel | undefined, model)
      ) {
        return;
      }
      if (!(await selectInternalModel(pi, live, model))) {
        live.context?.ui.notify("Codex switcher could not select the fallback profile.", "warning");
      }
    },
  };
  const routerOptions = {
    profiles: config.profiles,
    fallbackChain: config.fallbackChain,
    runtime,
    state,
  };
  const stream = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, streamContext, streamOptions) =>
      native.stream(model, streamContext, streamOptions),
  });
  const streamSimple = createCodexSwitcherStream({
    ...routerOptions,
    transport: (model, streamContext, streamOptions) =>
      native.streamSimple(model, streamContext, streamOptions),
  });
  for (const profile of config.profiles) {
    pi.registerProvider(createProfileProvider(native, profile, stream, streamSimple));
  }
  registerLifecycle(pi, config, state, live);
}

export default async function codexSwitcherExtension(pi: ExtensionAPI): Promise<void> {
  const path = codexSwitcherConfigPath(getAgentDir());
  const result = loadCodexSwitcherConfig(path);
  const nativeProvider = result.status === "ready" ? await loadOpenAICodexProvider() : undefined;
  installCodexSwitcher(pi, {
    configPath: path,
    configResult: result,
    ...(nativeProvider ? { nativeProvider } : {}),
  });
}

export {
  isCodexFamilyModel,
  isCodexFamilyProvider,
  isCodexProfileProvider,
} from "./codex-family.ts";
export { providerIdForProfile } from "./config.ts";
