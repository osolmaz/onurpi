/**
 * Pi wiring for the image budget.
 *
 * `tool_result` bounds what enters the session, `context` bounds what leaves for the provider, and
 * the two together keep a vision-heavy session inside a provider's request-body limit. All policy
 * lives in `session-policy.ts`; this file only connects hooks.
 */

import { getAgentDir, resizeImage, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { ImageBudgetSession } from "./session-policy.ts";

export type ImageBudgetDeps = {
  agentDir: string;
  resize: typeof resizeImage;
};

export function registerImageBudget(pi: ExtensionAPI, deps: ImageBudgetDeps): void {
  const session = new ImageBudgetSession(deps);

  pi.on("session_start", (_event, ctx) => {
    session.onSessionStart(ctx);
  });

  pi.on("turn_start", () => {
    session.onTurnStart();
  });

  pi.on("tool_result", async (event, ctx) => session.onToolResult(event.content, ctx));

  pi.on("context", (event, ctx) => session.onContext(event.messages, ctx));

  pi.registerCommand("image-budget", {
    description: "Show or reload the image byte budget",
    handler: (args, ctx) => {
      session.command(args, ctx);
      return Promise.resolve();
    },
  });
}

export default function imageBudget(pi: ExtensionAPI): void {
  registerImageBudget(pi, { agentDir: getAgentDir(), resize: resizeImage });
}
