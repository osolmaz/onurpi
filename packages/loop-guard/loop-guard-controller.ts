import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { EpisodeBuilder } from "./feature-encoder.ts";
import {
  decisionLabel,
  interventionContent,
  LOOP_GUARD_EVENT,
  LOOP_GUARD_MESSAGE_TYPE,
  type LoopGuardEvent,
} from "./intervention-message.ts";
import { LoopDetector, turnCheckpoint, type LoopDecision } from "./loop-detector.ts";

export type LoopGuardState = "off" | "armed" | "nudged" | "tripped";

const STATUS_KEY = "loop-guard";
const CONTINUATION_PROMPT_PATTERN =
  /^(?:(?:please\s+)?(?:continue|proceed|resume)|go\s+on|keep\s+going|carry\s+on|go\s+ahead|you\s+decide|do\s+it)(?:\s+(?:please|now))?$/iu;

export function isContinuationPrompt(text: string): boolean {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]+/gu, " ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  return CONTINUATION_PROMPT_PATTERN.test(normalized);
}

function stateStatus(state: LoopGuardState): string | undefined {
  switch (state) {
    case "off":
      return undefined;
    case "armed":
      return "loop guard: on";
    case "nudged":
      return "loop guard: nudged";
    case "tripped":
      return "loop guard: tripped";
  }
}

type LoopGuardRuntime = Pick<ExtensionAPI, "events" | "sendMessage">;
type LoopGuardContext = Pick<ExtensionContext, "abort" | "hasPendingMessages" | "isIdle"> & {
  ui: Pick<ExtensionContext["ui"], "notify" | "setStatus">;
};
type LoopGuardInputEvent = {
  source: "extension" | "interactive" | "rpc";
  text: string;
};
type LoopGuardTurnEndEvent = {
  message: unknown;
  toolResults: readonly unknown[];
};
type LoopGuardAgentEndEvent = {
  messages: readonly unknown[];
};

export class LoopGuardController {
  private readonly detector = new LoopDetector();
  private episode: EpisodeBuilder | null = null;
  private episodeContinuationPrompt = false;
  private epoch = 0;
  private nextContinuationPrompt = false;
  private skipCurrentEpisodeAtSettle = false;
  private stateValue: LoopGuardState = "off";

  constructor(private readonly pi: LoopGuardRuntime) {}

  get state(): LoopGuardState {
    return this.stateValue;
  }

  get statusText(): string {
    switch (this.stateValue) {
      case "off":
        return "Loop Guard is off.";
      case "armed":
        return `Loop Guard is on and observing epoch ${String(this.epoch)}.`;
      case "nudged":
        return "Loop Guard sent one corrective message and will trip on the next detection.";
      case "tripped":
        return "Loop Guard is tripped and will not send another corrective message.";
    }
  }

  sessionStart(ctx: LoopGuardContext): void {
    this.disable(ctx, false);
  }

  sessionShutdown(ctx: LoopGuardContext): void {
    this.disable(ctx, false);
  }

  enable(ctx: LoopGuardContext): void {
    this.stateValue = "armed";
    this.startEpoch();
    this.updateStatus(ctx);
    ctx.ui.notify("Loop Guard enabled for a fresh detection epoch.", "info");
  }

  disable(ctx: LoopGuardContext, notify = true): void {
    this.stateValue = "off";
    this.clearRuntime();
    this.updateStatus(ctx);
    if (notify) ctx.ui.notify("Loop Guard disabled.", "info");
  }

  reset(ctx: LoopGuardContext): void {
    if (this.stateValue === "off") {
      ctx.ui.notify("Loop Guard is off. Use /loop-guard on first.", "warning");
      return;
    }
    this.stateValue = "armed";
    this.startEpoch();
    this.updateStatus(ctx);
    ctx.ui.notify("Loop Guard started a fresh detection epoch.", "info");
  }

  manualNudge(ctx: LoopGuardContext): void {
    if (this.stateValue === "off") {
      ctx.ui.notify("Loop Guard is off. Use /loop-guard on first.", "warning");
      return;
    }
    this.stateValue = "armed";
    this.startEpoch();
    this.processDecision({ kind: "manual_nudge" }, ctx, !ctx.isIdle());
  }

  input(event: LoopGuardInputEvent, ctx: LoopGuardContext): void {
    if (this.stateValue === "off" || event.source === "extension") return;
    const continuation = isContinuationPrompt(event.text);
    this.nextContinuationPrompt = continuation;
    if (continuation) return;
    this.stateValue = "armed";
    this.startEpoch();
    this.updateStatus(ctx);
  }

  agentStart(): void {
    if (!this.isCollecting() || this.episode !== null) return;
    this.episode = new EpisodeBuilder();
    this.episodeContinuationPrompt = this.nextContinuationPrompt;
    this.nextContinuationPrompt = false;
  }

  turnEnd(event: LoopGuardTurnEndEvent, ctx: LoopGuardContext): void {
    if (!this.isCollecting() || this.episode === null) return;
    this.episode.accountTurn(event.message, event.toolResults);
    const decision = turnCheckpoint(this.episode.turns);
    if (decision !== null) this.processDecision(decision, ctx, true);
  }

  agentEnd(event: LoopGuardAgentEndEvent): void {
    if (!this.isCollecting() || this.episode === null) return;
    this.episode.accountAgentEnd(event.messages);
  }

  agentSettled(ctx: LoopGuardContext): void {
    if (this.stateValue === "off" || this.episode === null) return;
    const episode = this.episode;
    this.episode = null;
    if (this.skipCurrentEpisodeAtSettle) {
      this.skipCurrentEpisodeAtSettle = false;
      return;
    }
    const decision = this.detector.observe(episode.finish(this.episodeContinuationPrompt));
    this.episodeContinuationPrompt = false;
    if (decision !== null) this.processDecision(decision, ctx, false);
  }

  private isCollecting(): boolean {
    return this.stateValue === "armed" || this.stateValue === "nudged";
  }

  private processDecision(decision: LoopDecision, ctx: LoopGuardContext, activeRun: boolean): void {
    if (this.stateValue === "tripped" || this.stateValue === "off") return;
    if (this.stateValue === "nudged") {
      this.trip(decision, ctx, activeRun);
      return;
    }
    this.nudge(decision, ctx, activeRun);
  }

  private nudge(decision: LoopDecision, ctx: LoopGuardContext, activeRun: boolean): void {
    this.stateValue = "nudged";
    this.detector.reset();
    this.nextContinuationPrompt = false;
    this.skipCurrentEpisodeAtSettle = activeRun;
    this.updateStatus(ctx);

    const message = {
      customType: LOOP_GUARD_MESSAGE_TYPE,
      content: interventionContent(decision),
      details: { decision, version: 1 as const },
      display: true,
    };
    try {
      if (activeRun) {
        this.pi.sendMessage(message, { deliverAs: "steer" });
      } else {
        this.pi.sendMessage(message, {
          deliverAs: "followUp",
          triggerTurn: ctx.isIdle() && !ctx.hasPendingMessages(),
        });
      }
    } catch {
      this.stateValue = "tripped";
      this.updateStatus(ctx);
      this.emit("trip", decision);
      if (activeRun) ctx.abort();
      ctx.ui.notify("Loop Guard could not deliver its intervention and tripped safely.", "error");
      return;
    }
    this.emit("nudge", decision);
    ctx.ui.notify(`Loop Guard intervened after ${decisionLabel(decision)}.`, "warning");
  }

  private trip(decision: LoopDecision, ctx: LoopGuardContext, activeRun: boolean): void {
    this.stateValue = "tripped";
    this.detector.reset();
    this.skipCurrentEpisodeAtSettle = activeRun;
    this.updateStatus(ctx);
    this.emit("trip", decision);
    if (activeRun) ctx.abort();
    ctx.ui.notify(
      "Loop Guard tripped. Automatic intervention stopped; give substantive direction or run /loop-guard reset.",
      "error",
    );
  }

  private emit(action: LoopGuardEvent["action"], decision: LoopDecision): void {
    const event: LoopGuardEvent = { action, decision, version: 1 };
    this.pi.events.emit(LOOP_GUARD_EVENT, event);
  }

  private startEpoch(): void {
    this.epoch += 1;
    this.clearRuntime();
  }

  private clearRuntime(): void {
    this.detector.reset();
    this.episode = null;
    this.episodeContinuationPrompt = false;
    this.nextContinuationPrompt = false;
    this.skipCurrentEpisodeAtSettle = false;
  }

  private updateStatus(ctx: LoopGuardContext): void {
    ctx.ui.setStatus(STATUS_KEY, stateStatus(this.stateValue));
  }
}
