import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildWorkflowInput,
  fetchInventory,
  formatIssueChoice,
  isForbiddenMaintainerCommand,
  parseIssueReference,
  requestWorkflowStart,
  type MaintainerIssue,
} from "./maintainer.ts";

const WORKFLOW_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "openclaw-maintainer.workflow.ts",
);
const PICKER_TIMEOUT_MS = 15_000;

export default function onurOpenClawMaintainer(pi: ExtensionAPI): void {
  let starting = false,
    readOnlyRun = false;

  registerMaintainerFlags(pi);

  const start = async (ctx: ExtensionContext, rawReference?: string): Promise<void> => {
    if (starting) {
      ctx.ui.notify("The OpenClaw maintainer workflow is already starting.", "warning");
      return;
    }
    if (!ctx.hasUI) {
      throw new Error("The OpenClaw issue picker requires Pi TUI or RPC mode");
    }
    starting = true;
    try {
      const issue = rawReference?.trim()
        ? requireIssueReference(rawReference)
        : await selectIssue(ctx);
      if (!issue) return;
      readOnlyRun = true;
      pi.setSessionName(`OpenClaw #${String(issue.number)} workflow test`);
      ctx.ui.setStatus("onur-openclaw-maintainer", `OC #${String(issue.number)} workflow test`);
      const result = await requestWorkflowStart({
        bus: pi.events,
        input: buildWorkflowInput(issue),
        ref: WORKFLOW_PATH,
        requestId: randomUUID(),
      });
      if (!result.ok) {
        readOnlyRun = false;
        ctx.ui.setStatus("onur-openclaw-maintainer", undefined);
        ctx.ui.notify(`Could not start the maintainer workflow: ${result.error}`, "error");
        return;
      }
      ctx.ui.notify(
        `Started ${result.workflowName} for #${String(issue.number)}. This is a workflow test; GitHub writes, commits, and merges are blocked.`,
        "info",
      );
    } finally {
      starting = false;
    }
  };

  pi.registerCommand("openclaw-maintainer", {
    description: "Start read-only OpenClaw local-model issue triage",
    handler: async (args, ctx) => {
      try {
        await start(ctx, args);
      } catch (error: unknown) {
        ctx.ui.notify(errorMessage(error), "error");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    const enabled = pi.getFlag("openclaw-maintainer") === true;
    const issue = pi.getFlag("openclaw-issue");
    if (!enabled && typeof issue !== "string") return;
    queueMicrotask(() => {
      void start(ctx, typeof issue === "string" ? issue : undefined).catch((error: unknown) => {
        ctx.ui.notify(errorMessage(error), "error");
      });
    });
  });

  pi.on("tool_call", (event) => guardMaintainerToolCall(readOnlyRun, event));

  pi.on("session_shutdown", (_event, ctx) => {
    starting = false;
    readOnlyRun = false;
    if (ctx.hasUI) ctx.ui.setStatus("onur-openclaw-maintainer", undefined);
  });
}

function guardMaintainerToolCall(
  active: boolean,
  event: { toolName: string; input: unknown },
): { block: true; reason: string } | undefined {
  if (!active) return undefined;
  if (event.toolName === "edit" || event.toolName === "write") {
    return { block: true, reason: "The OpenClaw maintainer workflow is running read-only." };
  }
  const command = toolCommand(event.input);
  return command && isForbiddenMaintainerCommand(command)
    ? {
        block: true,
        reason: "GitHub writes, commits, pushes, and merges are blocked during this workflow test.",
      }
    : undefined;
}

function registerMaintainerFlags(pi: ExtensionAPI): void {
  pi.registerFlag("openclaw-maintainer", {
    description: "Pick an OpenClaw local-model issue and start the read-only maintainer workflow",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("openclaw-issue", {
    description: "OpenClaw issue number or URL to start with --openclaw-maintainer",
    type: "string",
  });
}

async function selectIssue(ctx: ExtensionContext): Promise<MaintainerIssue | undefined> {
  const issues = await fetchInventory(fetch, AbortSignal.timeout(PICKER_TIMEOUT_MS));
  const labels = issues.map(formatIssueChoice);
  const selected = await ctx.ui.select("Choose an OpenClaw local-model issue", labels);
  if (!selected) return undefined;
  const index = labels.indexOf(selected);
  return index >= 0 ? issues[index] : undefined;
}

function requireIssueReference(value: string): MaintainerIssue {
  const issue = parseIssueReference(value);
  if (!issue) {
    throw new Error(
      "Use an OpenClaw issue number or https://github.com/openclaw/openclaw/issues/<number>",
    );
  }
  return issue;
}

function toolCommand(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  if ("cmd" in input && typeof input.cmd === "string") return input.cmd;
  if ("command" in input && typeof input.command === "string") return input.command;
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
