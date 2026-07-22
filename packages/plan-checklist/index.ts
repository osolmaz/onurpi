import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

import { addPlanContextBridge } from "./plan-context.ts";
import { fallbackToolText, PlanWidget, renderPlanCall, renderPlanResult } from "./plan-render.ts";
import { replayPlanSnapshot } from "./plan-replay.ts";
import {
  decodePlanSnapshot,
  type PlanSnapshot,
  UPDATE_PLAN_TOOL_NAME,
  UpdatePlanParameters,
} from "./plan-schema.ts";
import { PlanState } from "./plan-state.ts";

const WIDGET_KEY = "plan-checklist";

function updateWidget(ctx: ExtensionContext, snapshot: PlanSnapshot | undefined): void {
  if (ctx.mode !== "tui") return;
  if (!snapshot) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new PlanWidget(snapshot, theme), {
    placement: "aboveEditor",
  });
}

export default function planChecklist(pi: ExtensionAPI): void {
  const state = new PlanState();

  const restore = (ctx: ExtensionContext): void => {
    const replayed = replayPlanSnapshot(ctx.sessionManager.getBranch());
    state.replace(replayed.snapshot, replayed.sourceTimestamp);
    updateWidget(ctx, state.get().snapshot);
  };

  pi.registerTool({
    name: UPDATE_PLAN_TOOL_NAME,
    label: "Update Plan",
    description:
      "Replace the complete current task checklist. Send every step on each call, in display order, using pending, in_progress, or completed status. Use an empty plan to clear it.",
    promptSnippet: "Publish or replace the current multi-step task checklist",
    promptGuidelines: [
      "Use update_plan for meaningful multi-step work and skip it for trivial or one-step tasks.",
      "Every update_plan call must include the complete current checklist, with at most one in_progress step.",
      "Call update_plan after verified progress so completed and in_progress statuses stay current.",
    ],
    parameters: UpdatePlanParameters,
    executionMode: "sequential",
    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const update = state.apply(params, Date.now());
      updateWidget(ctx, state.get().snapshot);
      return Promise.resolve({
        content: [{ type: "text", text: "Plan updated" }],
        details: update.snapshot,
      });
    },
    renderCall(args, theme) {
      return renderPlanCall(args.explanation, theme);
    },
    renderResult(result, { expanded }, theme) {
      const snapshot = decodePlanSnapshot(result.details);
      if (!snapshot) return new Text(fallbackToolText(result.content), 0, 0);
      return renderPlanResult(snapshot, expanded, theme);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    restore(ctx);
  });
  pi.on("session_tree", (_event, ctx) => {
    restore(ctx);
  });
  pi.on("session_compact", (_event, ctx) => {
    restore(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    state.clear();
    updateWidget(ctx, undefined);
  });
  pi.on("context", (event) => {
    const messages = addPlanContextBridge(event.messages, state.get());
    return messages === event.messages ? undefined : { messages };
  });
}
