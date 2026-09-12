/**
 * Stateful policy for one session.
 *
 * Keeps the config reload, the counters, the notification gating, and the footer status in one
 * place with narrow types, so `index.ts` stays a thin set of Pi hooks.
 */

import type { resizeImage } from "@earendil-works/pi-coding-agent";

import { handleImageBudgetCommand, type ImageBudgetSnapshot } from "./command.ts";
import { configPath, readConfig, type ConfigLoad } from "./config.ts";
import { applyContextPolicy, type ContextMessages } from "./context-policy.ts";
import {
  formatStatus,
  redactionNotice,
  resultOutcomeNotice,
  type ImageBudgetConfig,
  type ResultOutcome,
} from "./image-budget.ts";
import { applyResultPolicy, type ToolResultContent } from "./result-policy.ts";

export type UiContext = {
  mode: string;
  hasUI: boolean;
  ui: {
    notify: (message: string, type?: "info" | "warning" | "error") => void;
    setStatus: (key: string, text: string | undefined) => void;
  };
};

export type SessionPolicyDeps = {
  agentDir: string;
  resize: typeof resizeImage;
};

export const STATUS_KEY = "image-budget";

const NO_OUTCOME: ResultOutcome = { omitted: 0, resized: 0, dropped: 0, bytesSaved: 0 };

function addOutcome(total: ResultOutcome, next: ResultOutcome): ResultOutcome {
  return {
    omitted: total.omitted + next.omitted,
    resized: total.resized + next.resized,
    dropped: total.dropped + next.dropped,
    bytesSaved: total.bytesSaved + next.bytesSaved,
  };
}

export class ImageBudgetSession {
  private load: ConfigLoad;
  private notifiedThisTurn = false;
  private redacting = false;
  private lastBytes = 0;
  private lastImageCount = 0;
  private redactions = 0;
  private outcome: ResultOutcome = { ...NO_OUTCOME };

  constructor(private readonly deps: SessionPolicyDeps) {
    this.load = readConfig(this.path);
  }

  get path(): string {
    return configPath(this.deps.agentDir);
  }

  get config(): ImageBudgetConfig {
    return this.load.config;
  }

  snapshot(): ImageBudgetSnapshot {
    return {
      configPath: this.path,
      config: this.config,
      errors: this.load.errors,
      lastBytes: this.lastBytes,
      lastImageCount: this.lastImageCount,
      redactions: this.redactions,
      outcome: this.outcome,
    };
  }

  reload(): readonly string[] {
    this.load = readConfig(this.path);
    return this.load.errors;
  }

  onSessionStart(ctx: UiContext): void {
    const errors = this.reload();
    this.notifiedThisTurn = false;
    if (ctx.hasUI && errors.length > 0) {
      ctx.ui.notify(`image-budget: ${errors.join("; ")}`, "warning");
    }
  }

  onTurnStart(): void {
    this.notifiedThisTurn = false;
  }

  async onToolResult(
    content: ToolResultContent,
    ctx: UiContext,
  ): Promise<{ content: ToolResultContent } | undefined> {
    if (!this.config.enabled) return undefined;
    const policy = await applyResultPolicy(content, this.config, this.deps.resize);
    if (policy.content === content) return undefined;
    this.outcome = addOutcome(this.outcome, policy.outcome);
    const notice = resultOutcomeNotice(policy.outcome);
    if (notice !== undefined) this.notify(ctx, notice, "info");
    return { content: policy.content };
  }

  onContext(messages: ContextMessages, ctx: UiContext): { messages: ContextMessages } | undefined {
    if (!this.config.enabled) return undefined;
    const outcome = applyContextPolicy(messages, this.config);
    this.lastBytes = outcome.bytesAfter;
    this.lastImageCount = outcome.imageCount - outcome.redactCount;
    this.applyStatus(ctx);
    if (outcome.redactCount === 0) {
      this.redacting = false;
      return undefined;
    }
    this.redactions += outcome.redactCount;
    if (!this.redacting) this.notify(ctx, redactionNotice(outcome), "warning");
    this.redacting = true;
    return { messages };
  }

  onShutdown(ctx: UiContext): void {
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);
  }

  command(args: string, ctx: UiContext): void {
    handleImageBudgetCommand(
      args,
      { reload: () => this.reload(), snapshot: () => this.snapshot() },
      ctx,
    );
  }

  private notify(ctx: UiContext, message: string, type: "info" | "warning" | "error"): void {
    if (!this.config.notify || !ctx.hasUI || this.notifiedThisTurn) return;
    ctx.ui.notify(message, type);
    this.notifiedThisTurn = true;
  }

  private applyStatus(ctx: UiContext): void {
    if (ctx.mode !== "tui" || !this.config.status) return;
    const text =
      this.lastImageCount > 0
        ? formatStatus(this.lastBytes, this.config.imageBudgetBytes)
        : undefined;
    ctx.ui.setStatus(STATUS_KEY, text);
  }
}
