/**
 * Stateful policy for one session.
 *
 * Keeps the config reload, the last measurement, and the warn-once gate in one place, so `index.ts`
 * stays a thin set of Pi hooks. The measurement is refreshed three times: at session start from the
 * system prompt and tool metadata, before the first agent turn with the exact context files, and
 * once more from the provider payload, which carries the real tool declarations.
 */

import { handleContextBudgetCommand, WIDGET_KEY } from "./command.ts";
import { configPath, readConfig, type ConfigLoad } from "./config.ts";
import {
  budgetWarning,
  measureContext,
  measureRequestTools,
  statusText,
  type ContextBudgetConfig,
  type ContextMeasurement,
  type ReportInput,
  type ToolDeclaration,
} from "./context-budget.ts";

export const STATUS_KEY = "context-budget";

export type ContextUsage = {
  tokens: number | null;
  contextWindow: number;
};

export type UiContext = {
  hasUI: boolean;
  ui: {
    notify: (message: string, type?: "info" | "warning" | "error") => void;
    setStatus: (key: string, text: string | undefined) => void;
    setWidget: (key: string, content: string[] | undefined) => void;
  };
  getContextUsage?: () => ContextUsage | undefined;
};

export type SessionDeps = {
  agentDir: string;
};

export type PromptInput = {
  prompt: string;
  tools?: readonly ToolDeclaration[];
  files?: readonly { path: string; content: string }[];
};

export type RequestInput = {
  payload: unknown;
  prompt: string;
  tools?: readonly ToolDeclaration[];
};

export class ContextBudgetSession {
  private load: ConfigLoad;
  private measurement: ContextMeasurement | undefined;
  private conversation: ContextUsage | undefined;
  private warned = false;

  constructor(private readonly deps: SessionDeps) {
    this.load = readConfig(this.path);
  }

  get path(): string {
    return configPath(this.deps.agentDir);
  }

  get config(): ContextBudgetConfig {
    return this.load.config;
  }

  get current(): ContextMeasurement | undefined {
    return this.measurement;
  }

  reload(): readonly string[] {
    this.load = readConfig(this.path);
    return this.load.errors;
  }

  snapshot(): ReportInput {
    return {
      configPath: this.path,
      config: this.config,
      measurement: this.measurement,
      errors: this.load.errors,
      conversationTokens: this.conversation?.tokens ?? undefined,
      contextWindow: this.conversation?.contextWindow,
    };
  }

  onSessionStart(input: PromptInput, ctx: UiContext): void {
    this.measurement = undefined;
    this.conversation = undefined;
    this.warned = false;
    const errors = this.reload();
    if (ctx.hasUI && errors.length > 0) {
      ctx.ui.notify(`context-budget: ${errors.join("; ")}`, "warning");
    }
    if (input.prompt.length > 0) this.record(input, ctx);
  }

  onBeforeAgentStart(input: PromptInput, ctx: UiContext): void {
    this.record(input, ctx);
  }

  onRequest(input: RequestInput, ctx: UiContext): void {
    const requestTools = measureRequestTools(input.payload);
    if (requestTools.length === 0) return;
    this.record({ ...input, measurementTools: requestTools }, ctx);
  }

  command(args: string, ctx: UiContext): void {
    handleContextBudgetCommand(
      args,
      {
        reload: () => this.reload(),
        snapshot: () => {
          this.captureUsage(ctx);
          return this.snapshot();
        },
      },
      ctx,
    );
  }

  onSessionShutdown(ctx: UiContext): void {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
  }

  private record(
    input: PromptInput & { measurementTools?: readonly { name: string; chars: number }[] },
    ctx: UiContext,
  ): void {
    this.measurement = measureContext({
      prompt: input.prompt,
      tools: input.tools ?? [],
      files: input.files ?? [],
      ...(input.measurementTools === undefined ? {} : { requestTools: input.measurementTools }),
    });
    this.captureUsage(ctx);
    if (this.config.enabled) {
      ctx.ui.setStatus(STATUS_KEY, statusText(this.measurement, this.config));
    }
    this.warnOnce(ctx);
  }

  private captureUsage(ctx: UiContext): void {
    this.conversation = ctx.getContextUsage?.();
  }

  private warnOnce(ctx: UiContext): void {
    if (this.warned || !ctx.hasUI) return;
    const message =
      this.measurement === undefined ? undefined : budgetWarning(this.measurement, this.config);
    if (message === undefined) return;
    this.warned = true;
    ctx.ui.notify(message, "warning");
  }
}
