/**
 * Pi wiring for the session policy.
 *
 * `tool_result` replaces image payloads with markers before Pi persists them, `context` re-attaches
 * the cached picture while the entry is live, and `session_compact` plus `session_tree` drop the
 * cache entries that the live branch no longer references. All policy lives in `policy.ts` and
 * `session.ts`; this file only connects hooks.
 */

import {
  getAgentDir,
  resizeImage,
  sessionEntryToContextMessages,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import type { ContextMessages } from "./policy.ts";
import { SessionPolicy, type SessionPolicyDeps } from "./session.ts";

/** The live entries of the current branch, projected the way Pi projects them for the model. */
function liveMessages(ctx: ExtensionContext): ContextMessages {
  return ctx.sessionManager
    .buildContextEntries()
    .flatMap((entry) => sessionEntryToContextMessages(entry));
}

export function registerSessionPolicy(pi: ExtensionAPI, deps: SessionPolicyDeps): void {
  const session = new SessionPolicy(deps);

  pi.on("session_start", (_event, ctx) => {
    session.onSessionStart(ctx);
  });

  pi.on("session_shutdown", () => {
    session.onSessionShutdown();
  });

  pi.on("tool_result", async (event) => session.onToolResult(event.content, event.input));

  pi.on("context", (event, ctx) => session.onContext(event.messages, ctx));

  pi.on("session_compact", (_event, ctx) => {
    session.onLiveMessages(liveMessages(ctx));
  });

  pi.on("session_tree", (_event, ctx) => {
    session.onLiveMessages(liveMessages(ctx));
  });

  pi.registerCommand("session-policy", {
    description: "Show or reload the session image payload policy",
    handler: (args, ctx) => {
      session.command(args, ctx);
      return Promise.resolve();
    },
  });
}

export default function sessionPolicy(pi: ExtensionAPI): void {
  registerSessionPolicy(pi, { agentDir: getAgentDir(), resize: resizeImage });
}
