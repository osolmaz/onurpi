export type ModelIdentity = {
  provider: string;
  id: string;
};

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export type StartupModelResult =
  | "ignored"
  | "already-active"
  | "selected"
  | "missing"
  | "unauthorized";

export type StartupModelSession<Model extends ModelIdentity> = {
  activeModel: Model | undefined;
  findModel: (provider: string, modelId: string) => Model | undefined;
  notifyError: (message: string) => void;
};

export type StartupModelRuntime<Model extends ModelIdentity> = {
  onSessionStart: (
    handler: (reason: SessionStartReason, session: StartupModelSession<Model>) => Promise<void>,
  ) => void;
  setModel: (model: Model) => Promise<boolean>;
};

export const STARTUP_MODEL = {
  provider: "openai-codex",
  id: "gpt-5.6-sol",
} as const satisfies ModelIdentity;

export function registerStartupModel<Model extends ModelIdentity>(
  runtime: StartupModelRuntime<Model>,
  target: ModelIdentity = STARTUP_MODEL,
): void {
  runtime.onSessionStart(async (reason, session) => {
    const result = await applyStartupModel({
      reason,
      activeModel: session.activeModel,
      target,
      findModel: session.findModel,
      setModel: runtime.setModel,
    });
    const error = startupModelError(result, target);
    if (error !== undefined) session.notifyError(error);
  });
}

export async function applyStartupModel<Model extends ModelIdentity>(options: {
  reason: SessionStartReason;
  activeModel: Model | undefined;
  target: ModelIdentity;
  findModel: (provider: string, modelId: string) => Model | undefined;
  setModel: (model: Model) => Promise<boolean>;
}): Promise<StartupModelResult> {
  if (options.reason !== "startup") return "ignored";
  if (modelsMatch(options.activeModel, options.target)) return "already-active";

  const model = options.findModel(options.target.provider, options.target.id);
  if (model === undefined) return "missing";

  return (await options.setModel(model)) ? "selected" : "unauthorized";
}

export function startupModelError(
  result: StartupModelResult,
  target: ModelIdentity,
): string | undefined {
  const model = `${target.provider}/${target.id}`;
  if (result === "missing") return `Startup model ${model} is unavailable`;
  if (result === "unauthorized") return `Startup model ${model} has no configured authentication`;
  return undefined;
}

function modelsMatch(model: ModelIdentity | undefined, target: ModelIdentity): boolean {
  return model?.provider === target.provider && model.id === target.id;
}
