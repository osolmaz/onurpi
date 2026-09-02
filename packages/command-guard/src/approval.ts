import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { APPROVAL_TTL_MS } from "./limits.ts";
import { verifyTargets } from "./path-policy.ts";
import { shellKind } from "./shell.ts";
import type {
  ApprovedCall,
  ApproveDecision,
  CommandContext,
  PolicyDecision,
  ResolvedTarget,
} from "./types.ts";

function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  if (process.platform !== "win32") return environment[key];
  const match = Object.keys(environment).find((name) => name.toLowerCase() === key.toLowerCase());
  return match ? environment[match] : undefined;
}

function environmentValues(
  keys: readonly string[],
  environment: NodeJS.ProcessEnv,
): readonly (readonly [string, string | undefined])[] {
  return keys.map((key) => [key, environmentValue(environment, key)] as const);
}

const POLICY_VERSION = 1;
const SECURITY_ENVIRONMENT_KEYS = [
  "BASHOPTS",
  "BASH_ENV",
  "CDPATH",
  "COMSPEC",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "ENV",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE",
  "GLOBIGNORE",
  "HOME",
  "IFS",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "PATH",
  "PATHEXT",
  "POSIXLY_CORRECT",
  "PS4",
  "PSModulePath",
  "SHELLOPTS",
  "ZDOTDIR",
] as const;

// eslint-disable-next-line complexity -- Indexed Git environment entries need strict shape checks.
function indexedGitConfiguration(environment: NodeJS.ProcessEnv): object {
  const raw = Object.entries(environment)
    .filter(([name]) => name.toUpperCase().startsWith("GIT_CONFIG_"))
    .sort(([left], [right]) => left.localeCompare(right));
  const countText = environmentValue(environment, "GIT_CONFIG_COUNT");
  if (countText === undefined && raw.length === 0) return { entries: [], extras: [] };
  if (!/^\d+$/u.test(countText ?? "")) return { invalid: raw };
  const count = Number(countText);
  if (!Number.isSafeInteger(count) || count > 256) return { invalid: raw };
  const expected = new Set(["GIT_CONFIG_COUNT"]);
  const entries: (readonly [string | undefined, string | undefined])[] = [];
  for (let index = 0; index < count; index++) {
    const keyName = `GIT_CONFIG_KEY_${String(index)}`;
    const valueName = `GIT_CONFIG_VALUE_${String(index)}`;
    expected.add(keyName);
    expected.add(valueName);
    const key = environmentValue(environment, keyName);
    const value = environmentValue(environment, valueName);
    if (key?.toLowerCase() !== "core.hookspath") entries.push([key, value]);
  }
  const extras = raw.filter(([name]) => !expected.has(name.toUpperCase()));
  return { entries, extras };
}

function securityEnvironment(environment: NodeJS.ProcessEnv): object {
  const bashFunctions = Object.entries(environment)
    .filter(([name]) => name.toUpperCase().startsWith("BASH_FUNC_"))
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    fixed: environmentValues(SECURITY_ENVIRONMENT_KEYS, environment),
    bashFunctions,
    gitConfiguration: indexedGitConfiguration(environment),
  };
}

function targetValue(target: ResolvedTarget): object {
  return {
    canonicalPath: target.canonicalPath,
    operandPath: target.operandPath,
    existed: target.existed,
    identity: target.identity,
    operandIdentity: target.operandIdentity,
  };
}

export function commandFingerprint(
  context: CommandContext,
  environmentKeys: readonly string[],
  targets: readonly ResolvedTarget[],
): string {
  const value = JSON.stringify({
    policyVersion: POLICY_VERSION,
    command: context.command,
    cwd: resolve(context.cwd),
    environment: environmentValues(environmentKeys, context.environment),
    securityEnvironment: securityEnvironment(context.environment),
    shell: context.shell,
    shellKind: context.shellKind ?? shellKind(context.shell),
    targets: targets.map(targetValue),
  });
  return createHash("sha256").update(value).digest("hex");
}

function decisionTargets(decision: PolicyDecision): readonly ResolvedTarget[] {
  return decision.action === "approve" ? decision.targets : [];
}

function decisionEnvironmentKeys(decision: PolicyDecision): readonly string[] {
  if (decision.action === "allow" || decision.action === "approve") {
    return Object.keys(decision.referencedEnvironment).sort();
  }
  return [];
}

export class ApprovalStore {
  readonly #calls = new Map<string, ApprovedCall>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  remember(id: string, context: CommandContext, decision: PolicyDecision): void {
    if (decision.action === "deny" || decision.action === "rewrite") return;
    const environmentKeys = decisionEnvironmentKeys(decision);
    const targets = decisionTargets(decision);
    this.#calls.set(id, {
      environmentKeys,
      expiresAt: this.#now() + APPROVAL_TTL_MS,
      fingerprint: commandFingerprint(context, environmentKeys, targets),
      targets,
    });
  }

  consume(id: string, context: CommandContext): boolean {
    const call = this.#calls.get(id);
    this.#calls.delete(id);
    if (!call || call.expiresAt < this.#now()) return false;
    if (!verifyTargets(call.targets)) return false;
    return call.fingerprint === commandFingerprint(context, call.environmentKeys, call.targets);
  }

  discard(id: string): void {
    this.#calls.delete(id);
  }

  clear(): void {
    this.#calls.clear();
  }

  get size(): number {
    return this.#calls.size;
  }
}

export function approvalMessage(decision: ApproveDecision, context?: CommandContext): string {
  const operations = decision.operations.map((item) => `${item.command}: ${item.kind}`).join("\n");
  const targets = decision.targets.map((target) => target.canonicalPath).join("\n");
  const command = context
    ? `Command:\n${context.command}\n\nShell:\n${context.shell}\n\nWorking directory:\n${resolve(context.cwd)}\n\n`
    : "";
  return `${command}Operations:\n${operations}\n\nTargets:\n${targets}\n\nThis operation can remove or replace data. Allow this exact command once?`;
}
