import { evaluateCommand } from "./policy.ts";
import type { CommandContext, PolicyDecision } from "./types.ts";

export type CommandDecision = Readonly<{
  allowed: boolean;
  decision: PolicyDecision;
  reason?: string;
}>;

export async function checkCommand(context: CommandContext): Promise<CommandDecision> {
  const decision = await evaluateCommand(context);
  if (decision.action === "allow") return { allowed: true, decision };
  return { allowed: false, decision, reason: decision.reason };
}
