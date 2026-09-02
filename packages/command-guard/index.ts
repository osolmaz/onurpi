import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AdapterCoverage } from "./src/adapters.ts";
import { registerShellGuards } from "./src/builtins.ts";
import { ExecutionCheckStore } from "./src/execution-check.ts";
import { registerToolCallGuards } from "./src/tool-calls.ts";
import { registerUnifiedExecGuards } from "./src/unified-adapter.ts";

function statusText(
  pi: ExtensionAPI,
  coverage: AdapterCoverage,
  checks: ExecutionCheckStore,
): string {
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
    `Non-control write_stdin input is blocked. There is no bypass or confirmation gate.`,
  ].join("\n");
}

export default function commandGuard(pi: ExtensionAPI): void {
  const checks = new ExecutionCheckStore();
  const coverage = new AdapterCoverage(pi);

  registerShellGuards(pi, checks);
  registerToolCallGuards(pi, checks, coverage);
  const stopUnifiedExecGuards = registerUnifiedExecGuards(checks);

  pi.registerCommand("command-guard", {
    description: "Show Command Guard coverage and pending checks",
    handler: (_args, ctx) => {
      ctx.ui.notify(statusText(pi, coverage, checks), "info");
      return Promise.resolve();
    },
  });
  pi.on("session_start", () => {
    checks.clear();
    coverage.enforce();
  });
  pi.on("before_agent_start", () => {
    coverage.enforce();
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
