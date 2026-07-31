import { StringEnum } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionStartEvent,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Spacer, Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

import {
  GOAL_EVENT_TYPE,
  GoalController,
  parseGoalEventDetails,
  type GoalEventDetails,
} from "./goal-controller.ts";
import {
  createGoalState,
  goalEventStatus,
  normalizeTokenBudget,
  parseTokenBudget,
  pauseLabel,
  statusLine,
  type GoalState,
} from "./goal-state.ts";

const LOOP_GUARD_EVENT = "onurpi:loop-guard";
const EmptyParameters = Type.Object({}, { additionalProperties: false });
const CreateGoalParameters = Type.Object(
  {
    objective: Type.String({ description: "The concrete objective to pursue." }),
    tokenBudget: Type.Optional(
      Type.Number({
        description: "Optional positive token budget, only when explicitly requested.",
        minimum: 1,
      }),
    ),
  },
  { additionalProperties: false },
);
const UpdateGoalParameters = Type.Object(
  {
    status: StringEnum(["complete"] as const, { description: "Only complete is accepted." }),
  },
  { additionalProperties: false },
);

type CreateGoalInput = Static<typeof CreateGoalParameters>;

function remainingTokens(goal: GoalState): number | null {
  return goal.tokenBudget === null ? null : Math.max(0, goal.tokenBudget - goal.tokensUsed);
}

function goalResult(goal: GoalState): string {
  return JSON.stringify({ goal, remainingTokens: remainingTokens(goal) }, null, 2);
}

function eventLabel(details: GoalEventDetails | undefined): string {
  if (details?.pause) return pauseLabel(details.pause);
  return goalEventStatus(details?.kind ?? "continuation");
}

function expandedEventLines(
  details: GoalEventDetails | undefined,
  label: string,
  theme: Theme,
): string[] {
  const lines = [`${theme.fg("dim", "Status: ")}${theme.fg("customMessageText", label)}`];
  if (details?.objective) {
    lines.push(`${theme.fg("dim", "Goal: ")}${theme.fg("customMessageText", details.objective)}`);
  }
  if (details?.usage) {
    lines.push(`${theme.fg("dim", "Usage: ")}${theme.fg("customMessageText", details.usage)}`);
  }
  return lines;
}

function registerRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(GOAL_EVENT_TYPE, (message, { expanded }, theme) => {
    const details = parseGoalEventDetails(message.details);
    const label = eventLabel(details);
    const box = new Box(1, 1, (value) => theme.bg("customMessageBg", value));
    box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("Goal")), 0, 0));
    box.addChild(new Spacer(1));
    const text = expanded
      ? expandedEventLines(details, label, theme).join("\n")
      : `${theme.fg("customMessageText", label)} ${theme.fg("dim", "(ctrl+o to expand)")}`;
    box.addChild(new Text(text, 0, 0));
    return box;
  });
}

function registerGetGoalTool(pi: ExtensionAPI, controller: GoalController): void {
  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Read the current active thread goal, if one exists.",
    promptSnippet: "Read the current active goal and remaining budget while pursuing it",
    promptGuidelines: [
      "Only call get_goal when you need exact current state; the active objective is already in the system prompt.",
    ],
    parameters: EmptyParameters,
    execute() {
      const goal = controller.currentGoal();
      return Promise.resolve({
        content: [{ text: JSON.stringify({ goal }, null, 2), type: "text" }],
        details: { goal },
      });
    },
  });
}

function validateCreateInput(
  params: CreateGoalInput,
): { error: string } | { objective: string; tokenBudget: number | null } {
  const objective = params.objective.trim();
  if (!objective) return { error: "objective is required." };
  const parsedBudget = normalizeTokenBudget(params.tokenBudget);
  return parsedBudget.error
    ? { error: parsedBudget.error }
    : { objective, tokenBudget: parsedBudget.tokenBudget };
}

function registerCreateGoalTool(pi: ExtensionAPI, controller: GoalController): void {
  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description:
      "Create a new active thread goal only when explicitly requested. It sets or replaces the current thread goal. A goal must be a durable, evidence-checkable work contract: outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition.",
    promptSnippet: "Create an active goal only when the user explicitly requests goal mode",
    promptGuidelines: [
      "Use create_goal only when the user explicitly asks to set, start, or follow a goal.",
      "Do not infer goals from ordinary coding tasks or one-off prompts.",
      "Before creating a goal, define the outcome, verification surface, constraints, boundaries, iteration policy, and blocked stop condition.",
      "Use this shape when possible: <end state>, verified by <evidence>, while preserving <constraints>. State allowed and forbidden scope, how each iteration chooses its next action, and what evidence to return if blocked.",
      "Prefer a self-contained objective that survives continuation turns and context compaction.",
      "Ask a clarifying question when missing success criteria or boundaries materially affect the contract.",
      "When called, create_goal replaces any existing goal; call it only after an explicit goal request.",
      "Set tokenBudget only when the user explicitly requested a token budget.",
    ],
    parameters: CreateGoalParameters,
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const validated = validateCreateInput(params);
      if ("error" in validated) {
        return Promise.resolve({
          content: [{ text: validated.error, type: "text" }],
          details: {},
          isError: true,
        });
      }
      const next = createGoalState(validated.objective, validated.tokenBudget);
      controller.setGoal(ctx, next);
      controller.emitActive(next, ctx.isIdle());
      return Promise.resolve({
        content: [{ text: goalResult(next), type: "text" }],
        details: { goal: next },
      });
    },
  });
}

function registerUpdateGoalTool(pi: ExtensionAPI, controller: GoalController): void {
  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description:
      "Mark the current thread goal complete after a strict evidence audit. Final run usage is accounted by the runtime.",
    promptSnippet: "Mark the active goal complete only after a strict completion audit",
    promptGuidelines: [
      "Use update_goal only when the active objective is fully achieved and verified against concrete evidence.",
      "Do not use update_goal to pause, resume, abandon, or budget-limit a goal.",
    ],
    parameters: UpdateGoalParameters,
    execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const next = controller.complete(ctx);
      if (!next) {
        return Promise.resolve({
          content: [{ text: "No goal is set.", type: "text" }],
          details: {},
          isError: true,
        });
      }
      return Promise.resolve({
        content: [{ text: goalResult(next), type: "text" }],
        details: { goal: next },
      });
    },
  });
}

function registerTools(pi: ExtensionAPI, controller: GoalController): void {
  registerGetGoalTool(pi, controller);
  registerCreateGoalTool(pi, controller);
  registerUpdateGoalTool(pi, controller);
}

function goalStatus(controller: GoalController): string | undefined {
  const goal = controller.currentGoal();
  if (!goal) return undefined;
  const line = statusLine(goal) ?? "Goal";
  return `${line}\nObjective: ${goal.objective}\nAutomatic runs: ${String(goal.safety.automaticRunCount)}\nStatus bar: ${controller.isStatusBarEnabled() ? "on" : "off"}`;
}

async function replaceGoalFromCommand(
  objective: string,
  tokenBudget: number | null,
  controller: GoalController,
  ctx: ExtensionContext,
): Promise<void> {
  const current = controller.currentGoal();
  if (current && current.status !== "complete") {
    const confirmed = await ctx.ui.confirm(
      "Replace goal?",
      `Current: ${current.objective}\n\nNew: ${objective}`,
    );
    if (!confirmed) return;
  }
  const next = createGoalState(objective, tokenBudget);
  controller.setGoal(ctx, next);
  controller.emitActive(next, ctx.isIdle());
}

function changeGoalStatus(
  command: "pause" | "resume",
  controller: GoalController,
  ctx: ExtensionContext,
): void {
  const next = command === "pause" ? controller.pause(ctx) : controller.resume(ctx);
  if (!next) ctx.ui.notify("No goal is set.", "warning");
}

function statusBarValue(command: string, current: boolean): boolean {
  const value = command.split(/\s+/u)[1];
  if (value === "on") return true;
  if (value === "off") return false;
  return !current;
}

function handleStatusCommand(
  command: string,
  controller: GoalController,
  ctx: ExtensionContext,
): boolean {
  if (command && command !== "status") return false;
  ctx.ui.notify(goalStatus(controller) ?? "Usage: /goal [--tokens 50k] <objective>", "info");
  return true;
}

function handlePauseCommand(
  command: string,
  controller: GoalController,
  ctx: ExtensionContext,
): boolean {
  if (command !== "pause" && command !== "resume") return false;
  changeGoalStatus(command, controller, ctx);
  return true;
}

function handleClearCommand(
  command: string,
  controller: GoalController,
  ctx: ExtensionContext,
): boolean {
  if (command !== "clear") return false;
  if (!controller.clear(ctx)) ctx.ui.notify("No goal is set.", "info");
  return true;
}

function handleStatusBarCommand(
  command: string,
  controller: GoalController,
  ctx: ExtensionContext,
): boolean {
  if (
    command !== "statusbar" &&
    command !== "statusbar toggle" &&
    command !== "statusbar on" &&
    command !== "statusbar off"
  ) {
    return false;
  }
  const enabled = statusBarValue(command, controller.isStatusBarEnabled());
  controller.setStatusBar(ctx, enabled);
  ctx.ui.notify(`Goal status bar ${enabled ? "enabled" : "disabled"}.`, "info");
  return true;
}

function handleControlCommand(
  command: string,
  controller: GoalController,
  ctx: ExtensionContext,
): boolean {
  return (
    handleStatusCommand(command, controller, ctx) ||
    handlePauseCommand(command, controller, ctx) ||
    handleClearCommand(command, controller, ctx) ||
    handleStatusBarCommand(command, controller, ctx)
  );
}

async function handleGoalCommand(
  args: string,
  controller: GoalController,
  ctx: ExtensionContext,
): Promise<void> {
  const command = args.trim();
  if (handleControlCommand(command, controller, ctx)) return;
  const parsed = parseTokenBudget(command);
  if (parsed.error) {
    ctx.ui.notify(parsed.error, "warning");
    return;
  }
  if (!parsed.objective) {
    ctx.ui.notify("Usage: /goal [--tokens 50k] <objective>", "warning");
    return;
  }
  await replaceGoalFromCommand(parsed.objective, parsed.tokenBudget, controller, ctx);
}

function registerCommand(pi: ExtensionAPI, controller: GoalController): void {
  pi.registerCommand("goal", {
    description: "Set, view, pause, resume, clear, or configure a long-running goal",
    getArgumentCompletions: (prefix) => {
      const values = [
        "pause",
        "resume",
        "clear",
        "status",
        "statusbar",
        "statusbar on",
        "statusbar off",
      ];
      const filtered = values.filter((value) => value.startsWith(prefix));
      return filtered.length > 0 ? filtered.map((value) => ({ label: value, value })) : null;
    },
    handler: (args, ctx) => handleGoalCommand(args, controller, ctx),
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loopGuardAction(value: unknown): "nudge" | "trip" | undefined {
  if (!isRecord(value)) return undefined;
  const action = value["action"];
  const version = value["version"];
  return version === 1 && (action === "nudge" || action === "trip") ? action : undefined;
}

function registerLifecycle(pi: ExtensionAPI, controller: GoalController): void {
  let sessionContext: ExtensionContext | null = null;
  pi.events.on(LOOP_GUARD_EVENT, (value) => {
    const action = loopGuardAction(value);
    if (action !== undefined && sessionContext !== null) {
      controller.pauseForLoopGuard(sessionContext, action);
    }
  });
  pi.on("session_start", (event: SessionStartEvent, ctx) => {
    sessionContext = ctx;
    controller.restore(event, ctx);
  });
  pi.on("before_agent_start", (event) => {
    const systemPrompt = controller.systemPrompt(event.systemPrompt);
    return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
  });
  pi.on("agent_start", () => {
    controller.agentStart();
  });
  pi.on("turn_end", (event) => {
    controller.turnEnd(event);
  });
  pi.on("agent_end", (event) => {
    controller.agentEnd(event);
  });
  pi.on("agent_settled", (_event, ctx) => {
    controller.agentSettled(ctx);
  });
  pi.on("session_shutdown", () => {
    sessionContext = null;
    controller.shutdown();
  });
}

export default function goalExtension(pi: ExtensionAPI): void {
  const controller = new GoalController(pi);
  registerRenderer(pi);
  registerTools(pi, controller);
  registerCommand(pi, controller);
  registerLifecycle(pi, controller);
}
