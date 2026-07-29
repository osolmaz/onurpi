import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";

import { GoalEpisode } from "./goal-episode.ts";
import { activeGoalSystemPrompt, goalEventContent } from "./goal-prompt.ts";
import { GOAL_STATE_ENTRY, latestGoalState } from "./goal-replay.ts";
import {
  goalUsage,
  normalizeGoalPause,
  normalizeGoalState,
  pauseGoal,
  pauseLabel,
  resumeGoal,
  statusLine,
  truncateObjective,
  type GoalEventKind,
  type GoalPause,
  type GoalState,
} from "./goal-state.ts";
import { recordSettledRun } from "./run-outcome.ts";

export const GOAL_EVENT_TYPE = "pi-goal-event";
const ACTIVE_GOAL_TOOL_NAMES = ["get_goal", "update_goal"] as const;

export type GoalEventDetails = {
  goalId: string;
  kind: GoalEventKind;
  objective?: string;
  pause?: GoalPause;
  timestamp: number;
  usage: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function eventDetails(kind: GoalEventKind, state: GoalState): GoalEventDetails {
  const details: GoalEventDetails = {
    goalId: state.id,
    kind,
    timestamp: Date.now(),
    usage: goalUsage(state),
  };
  if (kind !== "continuation") details.objective = state.objective;
  if (kind === "paused" && state.safety.pause) details.pause = state.safety.pause;
  return details;
}

function currentEventDetails(
  record: Readonly<Record<string, unknown>>,
): GoalEventDetails | undefined {
  const goalId = record["goalId"];
  const kind = record["kind"];
  const timestamp = record["timestamp"];
  const usage = record["usage"];
  if (
    typeof goalId !== "string" ||
    !isGoalEventKind(kind) ||
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    typeof usage !== "string"
  ) {
    return undefined;
  }
  const objective = record["objective"];
  const pause = record["pause"];
  return {
    goalId,
    kind,
    ...(typeof objective === "string" ? { objective } : {}),
    ...(isGoalPause(pause) ? { pause } : {}),
    timestamp,
    usage,
  };
}

function upstreamEventDetails(
  record: Readonly<Record<string, unknown>>,
): GoalEventDetails | undefined {
  const state = normalizeGoalState(record["goal"]);
  const kind = record["kind"];
  const timestamp = record["timestamp"];
  if (!state || !isGoalEventKind(kind) || typeof timestamp !== "number") return undefined;
  return {
    goalId: state.id,
    kind,
    objective: state.objective,
    ...(kind === "paused" && state.safety.pause ? { pause: state.safety.pause } : {}),
    timestamp,
    usage: goalUsage(state),
  };
}

export function parseGoalEventDetails(value: unknown): GoalEventDetails | undefined {
  if (!isRecord(value)) return undefined;
  return currentEventDetails(value) ?? upstreamEventDetails(value);
}

function isGoalEventKind(value: unknown): value is GoalEventKind {
  return (
    value === "active" ||
    value === "continuation" ||
    value === "paused" ||
    value === "resumed" ||
    value === "cleared" ||
    value === "budget_limited" ||
    value === "complete"
  );
}

function isGoalPause(value: unknown): value is GoalPause {
  const normalized = normalizeGoalPause(value);
  return normalized !== undefined && normalized !== null;
}

function messageUsage(message: unknown): unknown {
  return typeof message === "object" && message !== null
    ? Reflect.get(message, "usage")
    : undefined;
}

export class GoalController {
  private continuationQueued = false;
  private episode: GoalEpisode | null = null;
  private goal: GoalState | null = null;
  private readonly pi: ExtensionAPI;
  private statusBarEnabled = true;

  constructor(pi: ExtensionAPI) {
    this.pi = pi;
  }

  currentGoal(): GoalState | null {
    return this.goal;
  }

  isStatusBarEnabled(): boolean {
    return this.statusBarEnabled;
  }

  setGoal(ctx: ExtensionContext, next: GoalState): void {
    this.persist(ctx, next);
  }

  complete(ctx: ExtensionContext): GoalState | undefined {
    if (!this.goal) return undefined;
    const next: GoalState = {
      ...this.goal,
      safety: { ...this.goal.safety, pause: null },
      status: "complete",
      updatedAt: Date.now(),
    };
    this.persist(ctx, next);
    this.emit("complete", next);
    return next;
  }

  clear(ctx: ExtensionContext): GoalState | undefined {
    if (!this.goal) return undefined;
    const previous = this.goal;
    this.persist(ctx, null);
    this.emit("cleared", previous);
    return previous;
  }

  pause(ctx: ExtensionContext): GoalState | undefined {
    if (!this.goal) return undefined;
    const next = pauseGoal(this.goal, { reason: "user" });
    this.persist(ctx, next);
    this.emit("paused", next);
    return next;
  }

  resume(ctx: ExtensionContext): GoalState | undefined {
    if (!this.goal) return undefined;
    const next = resumeGoal(this.goal);
    this.persist(ctx, next);
    this.emit("resumed", next);
    if (ctx.isIdle()) this.queueContinuation(ctx, next);
    return next;
  }

  setStatusBar(ctx: ExtensionContext, enabled: boolean): void {
    this.statusBarEnabled = enabled;
    this.pi.appendEntry(GOAL_STATE_ENTRY, { goal: this.goal, statusBarEnabled: enabled });
    this.updateStatusBar(ctx);
  }

  emitActive(state: GoalState, triggerTurn: boolean): void {
    this.emit("active", state, triggerTurn);
  }

  systemPrompt(systemPrompt: string): string {
    return this.goal?.status === "active"
      ? activeGoalSystemPrompt(systemPrompt, this.goal)
      : systemPrompt;
  }

  restore(event: SessionStartEvent, ctx: ExtensionContext): void {
    const restored = latestGoalState(ctx.sessionManager.getBranch());
    this.goal = restored.goal;
    this.statusBarEnabled = restored.statusBarEnabled;
    this.continuationQueued = false;
    this.episode = null;
    this.syncGoalTools();
    if (this.goal?.status === "active") {
      const paused = pauseGoal(this.goal, { reason: "reload" });
      this.persist(ctx, paused);
      ctx.ui.notify(
        `‖ Goal paused after ${event.reason}: ${truncateObjective(paused.objective)}\nUse /goal resume to continue, or /goal clear to stop.`,
        "info",
      );
      return;
    }
    this.updateStatusBar(ctx);
  }

  shutdown(): void {
    this.continuationQueued = false;
    this.episode = null;
    this.goal = null;
  }

  agentStart(startedAt = Date.now()): void {
    if (!this.episode && this.goal?.status === "active") {
      this.episode = new GoalEpisode(this.goal.id, startedAt);
    }
  }

  turnEnd(event: TurnEndEvent): void {
    if (!this.episode || this.episode.goalId !== this.goal?.id) return;
    this.episode.accountTurn(messageUsage(event.message));
  }

  agentEnd(event: AgentEndEvent): void {
    if (!this.episode || this.episode.goalId !== this.goal?.id) return;
    this.episode.addMessages(event.messages);
  }

  agentSettled(ctx: ExtensionContext, endedAt = Date.now()): void {
    const episode = this.episode;
    this.episode = null;
    if (episode && this.finishEpisode(ctx, episode, endedAt)) return;
    if (this.goal?.status === "active") this.queueContinuation(ctx, this.goal);
  }

  private finishEpisode(ctx: ExtensionContext, episode: GoalEpisode, endedAt: number): boolean {
    if (this.goal?.id !== episode.goalId) return false;
    const disposition = recordSettledRun(this.goal, episode.observation(endedAt), endedAt);
    this.persist(ctx, disposition.state);
    if (disposition.pause) {
      this.emit("paused", disposition.state);
      ctx.ui.notify(
        `Goal ${pauseLabel(disposition.pause)}. Use /goal resume to continue.`,
        "warning",
      );
      return true;
    }
    if (disposition.state.status !== "budget_limited") return false;
    this.emit("budget_limited", disposition.state);
    return true;
  }

  private emit(kind: GoalEventKind, state: GoalState, triggerTurn = false): void {
    this.pi.sendMessage(
      {
        content: goalEventContent(kind, state),
        customType: GOAL_EVENT_TYPE,
        details: eventDetails(kind, state),
        display: true,
      },
      triggerTurn ? { triggerTurn: true } : undefined,
    );
  }

  private persist(ctx: ExtensionContext, next: GoalState | null): void {
    this.goal = next;
    if (next?.status !== "active") this.continuationQueued = false;
    this.pi.appendEntry(GOAL_STATE_ENTRY, { goal: next, statusBarEnabled: this.statusBarEnabled });
    this.updateStatusBar(ctx);
    this.syncGoalTools();
  }

  private queueContinuation(ctx: ExtensionContext, state: GoalState): void {
    if (this.continuationQueued || state.status !== "active") return;
    this.continuationQueued = true;
    queueMicrotask(() => {
      this.continuationQueued = false;
      if (
        this.goal?.id !== state.id ||
        this.goal.status !== "active" ||
        !ctx.isIdle() ||
        ctx.hasPendingMessages()
      ) {
        return;
      }
      this.emit("continuation", this.goal, true);
    });
  }

  private syncGoalTools(): void {
    const active = new Set(this.pi.getActiveTools());
    active.add("create_goal");
    for (const name of ACTIVE_GOAL_TOOL_NAMES) {
      if (this.goal?.status === "active") active.add(name);
      else active.delete(name);
    }
    this.pi.setActiveTools([...active]);
  }

  private updateStatusBar(ctx: ExtensionContext): void {
    ctx.ui.setStatus(GOAL_STATE_ENTRY, this.statusBarEnabled ? (statusLine(this.goal) ?? "") : "");
  }
}
