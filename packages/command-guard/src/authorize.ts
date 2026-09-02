import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { approvalMessage } from "./approval.ts";
import { APPROVAL_TTL_MS } from "./limits.ts";
import { verifyTargets } from "./path-policy.ts";
import { evaluateCommand } from "./policy.ts";
import type { CommandContext, PolicyDecision } from "./types.ts";

export type ApprovalContext = Pick<ExtensionContext, "hasUI" | "signal"> &
  Readonly<{ ui: Pick<ExtensionContext["ui"], "confirm"> }>;

export type Authorization = Readonly<{
  allowed: boolean;
  decision: PolicyDecision;
  reason?: string;
}>;

export async function authorizeCommand(
  context: CommandContext,
  extensionContext: ApprovalContext,
): Promise<Authorization> {
  const decision = await evaluateCommand(context);
  if (decision.action === "allow") return { allowed: true, decision };
  if (decision.action === "deny" || decision.action === "rewrite") {
    return { allowed: false, decision, reason: decision.reason };
  }
  if (!extensionContext.hasUI) {
    return {
      allowed: false,
      decision,
      reason: "destructive command needs explicit approval, but approval UI is unavailable",
    };
  }
  const approved = await extensionContext.ui.confirm(
    "Command Guard",
    approvalMessage(decision, context),
    {
      ...(extensionContext.signal ? { signal: extensionContext.signal } : {}),
      timeout: APPROVAL_TTL_MS,
    },
  );
  if (!approved) {
    return { allowed: false, decision, reason: "destructive command was not approved" };
  }
  if (!verifyTargets(decision.targets)) {
    return { allowed: false, decision, reason: "destructive target changed before execution" };
  }
  return { allowed: true, decision };
}
