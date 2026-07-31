import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { LoopGuardController } from "./loop-guard-controller.ts";

const COMMANDS = ["on", "off", "status", "reset", "nudge"] as const;

type LoopGuardCommandContext = Parameters<LoopGuardController["enable"]>[0] & {
  waitForIdle(): Promise<void>;
};

export async function handleLoopGuardCommand(
  args: string,
  controller: LoopGuardController,
  ctx: LoopGuardCommandContext,
): Promise<void> {
  const command = args.trim().toLowerCase();
  switch (command) {
    case "on":
      controller.enable(ctx);
      return;
    case "off":
      controller.disable(ctx);
      return;
    case "status":
      ctx.ui.notify(controller.statusText, "info");
      return;
    case "reset":
      controller.reset(ctx);
      return;
    case "nudge":
      await ctx.waitForIdle();
      controller.manualNudge(ctx);
      return;
    default:
      ctx.ui.notify("Usage: /loop-guard on|off|status|reset|nudge", "warning");
  }
}

function registerCommand(pi: ExtensionAPI, controller: LoopGuardController): void {
  pi.registerCommand("loop-guard", {
    description: "Enable, inspect, reset, or disable bounded loop detection",
    getArgumentCompletions: (prefix) => {
      const matches = COMMANDS.filter((command) => command.startsWith(prefix));
      return matches.length === 0
        ? null
        : matches.map((command) => ({ label: command, value: command }));
    },
    handler: (args, ctx) => handleLoopGuardCommand(args, controller, ctx),
  });
}

function registerLifecycle(pi: ExtensionAPI, controller: LoopGuardController): void {
  pi.on("session_start", (_event, ctx) => {
    controller.sessionStart(ctx);
  });
  pi.on("input", (event, ctx) => {
    controller.input(event, ctx);
  });
  pi.on("agent_start", () => {
    controller.agentStart();
  });
  pi.on("message_start", (event) => {
    controller.messageStart(event);
  });
  pi.on("message_update", (event, ctx) => {
    controller.messageUpdate(event, ctx);
  });
  pi.on("turn_start", () => {
    controller.turnStart();
  });
  pi.on("turn_end", (event, ctx) => {
    controller.turnEnd(event, ctx);
  });
  pi.on("agent_end", (event) => {
    controller.agentEnd(event);
  });
  pi.on("agent_settled", (_event, ctx) => {
    controller.agentSettled(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    controller.sessionShutdown(ctx);
  });
}

export default function loopGuardExtension(pi: ExtensionAPI): void {
  const controller = new LoopGuardController(pi);
  registerCommand(pi, controller);
  registerLifecycle(pi, controller);
}
