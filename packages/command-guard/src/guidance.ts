import { shellKind } from "./shell.ts";
import type { CommandContext } from "./types.ts";

const RECOVERY_GUIDANCE = [
  "Command Guard checks each command separately. A parser, syntax, platform, or tool-availability failure does not prove that all command execution is unavailable.",
  "After such a failure, inspect the reason and test one small, independent read-only command through an available guarded shell before declaring a general execution blocker. Report only what the checks establish.",
  "Keep the guard enabled. Do not reroute a denied destructive action through another shell, interpreter, tool, or script. Do not retry unchanged commands that failed the same check.",
].join("\n");

export function withCommandGuardGuidance(systemPrompt: string): string {
  return systemPrompt.includes(RECOVERY_GUIDANCE)
    ? systemPrompt
    : `${systemPrompt}\n\n${RECOVERY_GUIDANCE}`;
}

export function scopedBlockReason(context: CommandContext, reason: string): string {
  const kind = context.shellKind ?? shellKind(context.shell);
  return `${kind} command was not run: ${reason}. This result applies to this command; other guarded commands may still work.`;
}
