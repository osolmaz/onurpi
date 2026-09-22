/**
 * Pi wiring for the context budget.
 *
 * `session_start` measures the system prompt and the tool metadata, `before_agent_start` adds the
 * exact context files, and `before_provider_request` replaces the tool estimate with the real
 * declarations from the outgoing payload. All policy lives in `session-policy.ts`; this file only
 * connects hooks.
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { ToolDeclaration } from "./context-budget.ts";
import { ContextBudgetSession } from "./session-policy.ts";

export type ContextBudgetDeps = {
  agentDir: string;
};

export function registerContextBudget(pi: ExtensionAPI, deps: ContextBudgetDeps): void {
  const session = new ContextBudgetSession(deps);

  const tools = (): ToolDeclaration[] => {
    const active = new Set(pi.getActiveTools());
    return pi
      .getAllTools()
      .filter((tool) => active.has(tool.name))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
  };

  pi.on("session_start", (_event, ctx) => {
    session.onSessionStart({ prompt: ctx.getSystemPrompt(), tools: tools() }, ctx);
  });

  pi.on("before_agent_start", (event, ctx) => {
    session.onBeforeAgentStart(
      {
        prompt: ctx.getSystemPrompt(),
        tools: tools(),
        files: event.systemPromptOptions.contextFiles,
      },
      ctx,
    );
  });

  pi.on("before_provider_request", (event, ctx) => {
    session.onRequest(
      { payload: event.payload, prompt: ctx.getSystemPrompt(), tools: tools() },
      ctx,
    );
  });

  pi.on("session_shutdown", (_event, ctx) => {
    session.onSessionShutdown(ctx);
  });

  pi.registerCommand("context-budget", {
    description: "Show the fixed beginning-context cost and its budget",
    handler: (args, ctx) => {
      session.command(args, ctx);
      return Promise.resolve();
    },
  });
}

export default function contextBudget(pi: ExtensionAPI): void {
  registerContextBudget(pi, { agentDir: getAgentDir() });
}
