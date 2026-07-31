import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { EpisodeBuilder } from "./feature-encoder.ts";
import {
  decisionLabel,
  interventionContent,
  LOOP_GUARD_EVENT,
  LOOP_GUARD_MESSAGE_TYPE,
  type LoopGuardEvent,
} from "./intervention-message.ts";
import { LoopDetector, type LoopDecision } from "./loop-detector.ts";
import { ThinkingStreamDetector } from "./thinking-stream-detector.ts";

export type LoopGuardState = "off" | "armed" | "nudged" | "tripped";

const STATUS_KEY = "loop-guard";
const CONTINUATION_CLAUSES = [
  "keep going",
  "carry on",
  "go ahead",
  "you decide",
  "you choose",
  "proceed",
  "continue",
  "resume",
  "go on",
  "do it",
] as const;
const CONTINUATION_JOINERS = ["and", "then"] as const;
const POLITE_WORDS = ["please", "now"] as const;

function consumePrefix(value: string, candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    if (value === candidate) return "";
    if (value.startsWith(`${candidate} `)) return value.slice(candidate.length + 1);
  }
  return undefined;
}

function trimPoliteWords(value: string): string {
  let remaining = value;
  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    for (const word of POLITE_WORDS) {
      if (remaining === word) return "";
      if (remaining.startsWith(`${word} `)) {
        remaining = remaining.slice(word.length + 1);
        changed = true;
      }
      if (remaining.endsWith(` ${word}`)) {
        remaining = remaining.slice(0, -(word.length + 1));
        changed = true;
      }
    }
  }
  return remaining;
}

export function isContinuationPrompt(text: string): boolean {
  let remaining = trimPoliteWords(
    text
      .normalize("NFKC")
      .toLowerCase()
      .replaceAll(/[^\p{L}\p{N}\s]+/gu, " ")
      .replaceAll(/\s+/gu, " ")
      .trim(),
  );
  let clauses = 0;
  while (remaining.length > 0 && clauses < 3) {
    const afterClause = consumePrefix(remaining, CONTINUATION_CLAUSES);
    if (afterClause === undefined) return false;
    clauses += 1;
    remaining = trimPoliteWords(afterClause);
    const afterJoiner = consumePrefix(remaining, CONTINUATION_JOINERS);
    if (afterJoiner === "") return false;
    if (afterJoiner !== undefined) remaining = trimPoliteWords(afterJoiner);
  }
  return clauses > 0 && remaining.length === 0;
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
  streamingBehavior?: "followUp" | "steer";
  text: string;
};
type LoopGuardMessageStartEvent = {
  message: unknown;
};
type LoopGuardMessageUpdateEvent = {
  assistantMessageEvent: {
    delta?: string;
    type: string;
  };
};
type LoopGuardTurnEndEvent = {
  message: unknown;
  toolResults: readonly unknown[];
};
type LoopGuardAgentEndEvent = {
  messages: readonly unknown[];
};

function isAssistantMessage(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Reflect.get(value, "role") === "assistant"
  );
}

export class LoopGuardController {
  private readonly detector = new LoopDetector();
  private episode: EpisodeBuilder | null = null;
  private episodeContinuationPrompt = false;
  private epoch = 0;
  private nextContinuationPrompt = false;
  private pendingStreamingNudge: LoopDecision | null = null;
  private restartEpisodeOnNextTurn = false;
  private skipCurrentEpisodeAtSettle = false;
  private stateValue: LoopGuardState = "off";
  private suppressCurrentThinking = false;
  private readonly thinkingDetector = new ThinkingStreamDetector();

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
    this.startEpoch(event.streamingBehavior !== undefined);
    this.updateStatus(ctx);
  }

  agentStart(): void {
    if (!this.isCollecting() || this.episode !== null) return;
    this.episode = new EpisodeBuilder();
    this.episodeContinuationPrompt = this.nextContinuationPrompt;
    this.nextContinuationPrompt = false;
    this.thinkingDetector.reset();
  }

  messageStart(event: LoopGuardMessageStartEvent): void {
    if (!this.isCollecting() || !isAssistantMessage(event.message)) return;
    this.suppressCurrentThinking = false;
    this.thinkingDetector.reset();
  }

  messageUpdate(event: LoopGuardMessageUpdateEvent, ctx: LoopGuardContext): void {
    if (!this.isCollecting() || this.restartEpisodeOnNextTurn || this.suppressCurrentThinking) {
      return;
    }
    const streamEvent = event.assistantMessageEvent;
    let decision: LoopDecision | null = null;
    if (streamEvent.type === "thinking_delta" && typeof streamEvent.delta === "string") {
      decision = this.thinkingDetector.observe(streamEvent.delta);
    } else if (streamEvent.type === "thinking_end") {
      decision = this.thinkingDetector.finish();
    }
    if (decision !== null) this.processStreamingDecision(decision, ctx);
  }

  turnStart(): void {
    if (!this.isCollecting() || !this.restartEpisodeOnNextTurn) return;
    this.episode = new EpisodeBuilder();
    this.episodeContinuationPrompt = false;
    this.restartEpisodeOnNextTurn = false;
  }

  turnEnd(event: LoopGuardTurnEndEvent): void {
    if (!this.isCollecting() || this.episode === null) return;
    this.episode.accountTurn(event.message, event.toolResults);
  }

  agentEnd(event: LoopGuardAgentEndEvent): void {
    if (!this.isCollecting() || this.episode === null) return;
    this.episode.accountAgentEnd(event.messages);
  }

  agentSettled(ctx: LoopGuardContext): void {
    if (this.stateValue === "off") return;
    if (this.episode === null) {
      this.restartEpisodeOnNextTurn = false;
      this.skipCurrentEpisodeAtSettle = false;
    } else {
      const episode = this.episode;
      this.episode = null;
      if (this.restartEpisodeOnNextTurn) {
        this.restartEpisodeOnNextTurn = false;
      } else if (this.skipCurrentEpisodeAtSettle) {
        this.skipCurrentEpisodeAtSettle = false;
      } else {
        const decision = this.detector.observe(episode.finish(this.episodeContinuationPrompt));
        this.episodeContinuationPrompt = false;
        if (decision !== null) this.processDecision(decision, ctx, false);
      }
    }
    this.deliverPendingStreamingNudge(ctx);
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

  private processStreamingDecision(decision: LoopDecision, ctx: LoopGuardContext): void {
    if (this.stateValue === "tripped" || this.stateValue === "off") return;
    if (this.stateValue === "nudged") {
      this.trip(decision, ctx, true);
      return;
    }

    this.stateValue = "nudged";
    this.detector.reset();
    this.thinkingDetector.reset();
    this.nextContinuationPrompt = false;
    this.pendingStreamingNudge = decision;
    this.skipCurrentEpisodeAtSettle = true;
    this.suppressCurrentThinking = true;
    this.updateStatus(ctx);
    this.emit("nudge", decision);
    ctx.abort();
    ctx.ui.notify(`Loop Guard aborted the response after ${decisionLabel(decision)}.`, "warning");
  }

  private nudge(decision: LoopDecision, ctx: LoopGuardContext, activeRun: boolean): void {
    this.stateValue = "nudged";
    this.detector.reset();
    this.thinkingDetector.reset();
    this.nextContinuationPrompt = false;
    this.skipCurrentEpisodeAtSettle = activeRun;
    this.updateStatus(ctx);

    if (!this.sendIntervention(decision, ctx, activeRun)) {
      this.failIntervention(decision, ctx, activeRun);
      return;
    }
    this.emit("nudge", decision);
    ctx.ui.notify(`Loop Guard intervened after ${decisionLabel(decision)}.`, "warning");
  }

  private deliverPendingStreamingNudge(ctx: LoopGuardContext): void {
    const decision = this.pendingStreamingNudge;
    if (decision === null || this.stateValue !== "nudged") return;
    this.pendingStreamingNudge = null;
    if (!this.sendIntervention(decision, ctx, false)) {
      this.failIntervention(decision, ctx, false);
      return;
    }
    ctx.ui.notify(
      "Loop Guard started one corrective follow-up after aborting the loop.",
      "warning",
    );
  }

  private sendIntervention(
    decision: LoopDecision,
    ctx: LoopGuardContext,
    activeRun: boolean,
  ): boolean {
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
      return true;
    } catch {
      return false;
    }
  }

  private failIntervention(
    decision: LoopDecision,
    ctx: LoopGuardContext,
    activeRun: boolean,
  ): void {
    this.stateValue = "tripped";
    this.pendingStreamingNudge = null;
    this.thinkingDetector.reset();
    this.updateStatus(ctx);
    this.emit("trip", decision);
    if (activeRun) ctx.abort();
    ctx.ui.notify("Loop Guard could not deliver its intervention and tripped safely.", "error");
  }

  private trip(decision: LoopDecision, ctx: LoopGuardContext, activeRun: boolean): void {
    this.stateValue = "tripped";
    this.detector.reset();
    this.pendingStreamingNudge = null;
    this.thinkingDetector.reset();
    this.skipCurrentEpisodeAtSettle = activeRun;
    this.suppressCurrentThinking = true;
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

  private startEpoch(preserveActiveEpisode = false): void {
    const activeEpisode = preserveActiveEpisode ? this.episode : null;
    this.epoch += 1;
    this.clearRuntime();
    this.episode = activeEpisode;
    this.restartEpisodeOnNextTurn = preserveActiveEpisode;
  }

  private clearRuntime(): void {
    this.detector.reset();
    this.thinkingDetector.reset();
    this.episode = null;
    this.episodeContinuationPrompt = false;
    this.nextContinuationPrompt = false;
    this.pendingStreamingNudge = null;
    this.restartEpisodeOnNextTurn = false;
    this.skipCurrentEpisodeAtSettle = false;
    this.suppressCurrentThinking = false;
  }

  private updateStatus(ctx: LoopGuardContext): void {
    ctx.ui.setStatus(STATUS_KEY, stateStatus(this.stateValue));
  }
}
