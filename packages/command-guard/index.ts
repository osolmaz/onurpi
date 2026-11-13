import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AdapterCoverage } from "./src/adapters.ts";
import { registerShellGuards } from "./src/builtins.ts";
import { ExecutionCheckStore } from "./src/execution-check.ts";
import { withCommandGuardGuidance } from "./src/guidance.ts";
import { createGuardState, guardSwitchStatus, type GuardState } from "./src/state.ts";
import { shellStatus } from "./src/status.ts";
import { registerToolCallGuards } from "./src/tool-calls.ts";
import { registerUnifiedExecGuards } from "./src/unified-adapter.ts";

const USAGE = "Usage: /command-guard [status|on|off]";

async function statusText(
  pi: ExtensionAPI,
  coverage: AdapterCoverage,
  checks: ExecutionCheckStore,
  state: GuardState,
): Promise<string> {
  if (!state.enabled) {
    return [
      "Command Guard is off for this session.",
      "Every guarded path runs without checks until you run `/command-guard on` or restart Pi.",
      guardSwitchStatus(state),
    ].join("\n");
  }
  coverage.enforce();
  const active = new Set(pi.getActiveTools());
  const guarded = ["bash", "powershell", "exec_command", "write_stdin"].filter((name) =>
    active.has(name),
  );
  const disabled = coverage.disabled.length > 0 ? coverage.disabled.join(", ") : "none";
  return [
    `Command Guard is active.`,
    `Guarded active tools: ${guarded.length > 0 ? guarded.join(", ") : "none"}.`,
    `Unsupported command tools disabled: ${disabled}.`,
    `Pending final command checks: ${String(checks.size)}.`,
    ...(await shellStatus()),
    guardSwitchStatus(state),
    `Non-control write_stdin input is blocked. There is no bypass or confirmation gate.`,
  ].join("\n");
}

export default function commandGuard(pi: ExtensionAPI): void {
  const checks = new ExecutionCheckStore();
  const coverage = new AdapterCoverage(pi);
  const state = createGuardState();

  registerShellGuards(pi, checks, state);
  registerToolCallGuards(pi, checks, coverage, state);
  const stopUnifiedExecGuards = registerUnifiedExecGuards(checks, state);

  pi.registerCommand("command-guard", {
    description: "Show Command Guard coverage, or switch the guard off and on",
    handler: async (args, ctx) => {
      const verb = args.trim().toLowerCase();
      if (verb === "off") {
        state.enabled = false;
        checks.clear();
        ctx.ui.notify(
          "Command Guard is off for this session. Guarded commands now run without checks. A restart turns it back on.",
          "warning",
        );
        return;
      }
      if (verb === "on") {
        state.enabled = true;
        checks.clear();
        coverage.enforce();
        ctx.ui.notify("Command Guard is on for this session.", "info");
        return;
      }
      if (verb === "" || verb === "status") {
        ctx.ui.notify(
          await statusText(pi, coverage, checks, state),
          state.enabled ? "info" : "warning",
        );
        return;
      }
      ctx.ui.notify(USAGE, "error");
    },
  });
  pi.on("session_start", () => {
    checks.clear();
    coverage.enforce();
  });
  pi.on("before_agent_start", (event) => {
    if (!state.enabled) return undefined;
    coverage.enforce();
    return { systemPrompt: withCommandGuardGuidance(event.systemPrompt) };
  });
  pi.on("session_before_switch", () => {
    checks.clear();
  });
  pi.on("session_before_fork", () => {
    checks.clear();
  });
  pi.on("session_shutdown", () => {
    checks.clear();
    stopUnifiedExecGuards();
  });
}
