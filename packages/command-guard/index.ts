import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { AdapterCoverage } from "./src/adapters.ts";
import { ApprovalStore } from "./src/approval.ts";
import { registerShellGuards } from "./src/builtins.ts";
import { registerToolCallGuards } from "./src/tool-calls.ts";
import { registerUnifiedExecGuards } from "./src/unified-adapter.ts";

function statusText(pi: ExtensionAPI, coverage: AdapterCoverage, approvals: ApprovalStore): string {
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
    `Pending one-use command checks: ${String(approvals.size)}.`,
    `Non-control write_stdin input is blocked. There is no bypass or permanent approval.`,
  ].join("\n");
}

export default function commandGuard(pi: ExtensionAPI): void {
  const approvals = new ApprovalStore();
  const coverage = new AdapterCoverage(pi);

  registerShellGuards(pi, approvals);
  registerToolCallGuards(pi, approvals, coverage);
  const stopUnifiedExecGuards = registerUnifiedExecGuards(approvals);

  pi.registerCommand("command-guard", {
    description: "Show Command Guard coverage and pending checks",
    handler: (_args, ctx) => {
      ctx.ui.notify(statusText(pi, coverage, approvals), "info");
      return Promise.resolve();
    },
  });
  pi.on("session_start", () => {
    approvals.clear();
    coverage.enforce();
  });
  pi.on("before_agent_start", () => {
    coverage.enforce();
  });
  pi.on("session_before_switch", () => {
    approvals.clear();
  });
  pi.on("session_before_fork", () => {
    approvals.clear();
  });
  pi.on("session_shutdown", () => {
    approvals.clear();
    stopUnifiedExecGuards();
  });
}
