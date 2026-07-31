import type { ExtensionAPI, ToolCallEvent } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { executeShellCommand, validateCheckoutPath, validateShellCommand } from "./shell-policy.ts";

const ACTIVE_TOOLS = new Set(["read", "grep", "find", "ls", "review_shell"]);

export default function reviewGuard(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "review_shell",
    label: "Review shell",
    description: "Run one guarded read-only repository inspection command",
    parameters: Type.Object({
      command: Type.String({ description: "One read-only command without shell operators" }),
    }),
    execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
      const command = await validateShellCommand(params.command, ctx.cwd);
      const result = await executeShellCommand(command, ctx.cwd, signal);
      return {
        content: [
          {
            type: "text",
            text: result.output === "" ? `(exit ${String(result.exitCode)})` : result.output,
          },
        ],
        details: result,
      };
    },
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!ACTIVE_TOOLS.has(event.toolName)) {
      return {
        block: true,
        reason: `Tool ${event.toolName} is unavailable in read-only review mode`,
      };
    }
    const inputPath = toolPath(event);
    if (inputPath === undefined) return;
    try {
      await validateCheckoutPath(inputPath, ctx.cwd);
      return undefined;
    } catch (error) {
      return { block: true, reason: error instanceof Error ? error.message : String(error) };
    }
  });
}

function toolPath(event: ToolCallEvent): string | undefined {
  if (isToolCallEventType("read", event)) return event.input.path;
  if (isToolCallEventType("grep", event)) return event.input.path;
  if (isToolCallEventType("find", event)) return event.input.path;
  if (isToolCallEventType("ls", event)) return event.input.path;
  return undefined;
}
