import { delimiter, isAbsolute } from "node:path";

import {
  classifyBash,
  classifyNonBash,
  classifyPowerShell,
  type Classification,
} from "./classifier.ts";
import { getBashParser } from "./bash-parser.ts";
import { MAX_COMMAND_BYTES } from "./limits.ts";
import { resolveTargets } from "./path-policy.ts";
import { shellKind } from "./shell.ts";
import type {
  CommandContext,
  DestructiveOperation,
  PolicyDecision,
  ResolvedWord,
  ShellKind,
} from "./types.ts";

function referencedVariables(classification: Classification): string[] {
  const variables = new Set(classification.referencedVariables ?? []);
  for (const operation of classification.operations) {
    for (const target of operation.targets) {
      for (const name of target.referencedVariables) variables.add(name);
    }
  }
  return [...variables].sort();
}

function environmentSnapshot(
  names: readonly string[],
  environment: NodeJS.ProcessEnv,
): Readonly<Record<string, string | undefined>> {
  return Object.fromEntries(names.map((name) => [name, environment[name]]));
}

function targetUncertainty(operations: readonly DestructiveOperation[]): ResolvedWord | undefined {
  return operations.flatMap((operation) => operation.targets).find((target) => !target.value);
}

const EXECUTABLE_CODE_ENVIRONMENT = [
  "DYLD_FRAMEWORK_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
] as const;

function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  if (process.platform !== "win32") return environment[key];
  const match = Object.keys(environment).find((name) => name.toLowerCase() === key.toLowerCase());
  return match ? environment[match] : undefined;
}

function unsafeProcessEnvironment(environment: NodeJS.ProcessEnv): string | undefined {
  const loader = EXECUTABLE_CODE_ENVIRONMENT.find((name) => environmentValue(environment, name));
  if (loader) return `${loader} can inject hidden executable code`;
  const searchPath = environmentValue(environment, "PATH");
  if (!searchPath) return "PATH is not set";
  if (searchPath.split(delimiter).some((entry) => !entry || !isAbsolute(entry))) {
    return "PATH contains a relative executable directory";
  }
  return undefined;
}

function unsafeBashEnvironment(shell: string, environment: NodeJS.ProcessEnv): string | undefined {
  if (/(?:^|[\\/])zsh(?:\.exe)?$/iu.test(shell))
    return "zsh startup files can run hidden shell code";
  if (environmentValue(environment, "BASH_ENV")) return "BASH_ENV can run hidden shell code";
  if (environmentValue(environment, "ENV")) return "ENV can run hidden shell code";
  if (environmentValue(environment, "SHELLOPTS")?.split(":").includes("xtrace")) {
    return "SHELLOPTS enables shell tracing with environment-controlled output";
  }
  if (Object.keys(environment).some((name) => name.toUpperCase().startsWith("BASH_FUNC_"))) {
    return "exported Bash functions can replace command behavior";
  }
  return undefined;
}

async function classify(context: CommandContext, kind: ShellKind): Promise<Classification> {
  const processEnvironmentReason = unsafeProcessEnvironment(context.environment);
  if (processEnvironmentReason) {
    return { operations: [], uncertainReason: processEnvironmentReason };
  }
  if (kind === "bash") {
    const environmentReason = unsafeBashEnvironment(context.shell, context.environment);
    if (environmentReason) return { operations: [], uncertainReason: environmentReason };
    return classifyBash(context.command, context.environment, await getBashParser());
  }
  if (kind === "powershell") return classifyPowerShell(context.command);
  if (kind === "cmd") return classifyNonBash(context.command, kind);
  return { operations: [], uncertainReason: "shell is not supported by Command Guard" };
}

// eslint-disable-next-line complexity -- Keep the ordered fail-closed policy outcomes visible.
export async function evaluateCommand(context: CommandContext): Promise<PolicyDecision> {
  try {
    if (Buffer.byteLength(context.command, "utf8") > MAX_COMMAND_BYTES) {
      return { action: "deny", reason: "command text exceeds safety limit" };
    }
    const kind = context.shellKind ?? shellKind(context.shell);
    const classification = await classify(context, kind);
    if (classification.uncertainReason) {
      return { action: "rewrite", reason: classification.uncertainReason };
    }
    if (classification.operations.length === 0) {
      return { action: "allow", operations: [], referencedEnvironment: {}, targets: [] };
    }
    const uncertain = targetUncertainty(classification.operations);
    if (uncertain) {
      return { action: "rewrite", reason: uncertain.reason ?? "destructive target is not exact" };
    }
    const resolution = await resolveTargets(classification.operations, context.cwd);
    if (!resolution.ok) return { action: resolution.action, reason: resolution.reason };
    const names = referencedVariables(classification);
    return {
      action: "allow",
      operations: classification.operations,
      referencedEnvironment: environmentSnapshot(names, context.environment),
      targets: resolution.targets,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { action: "deny", reason: `command check failed: ${message}` };
  }
}
