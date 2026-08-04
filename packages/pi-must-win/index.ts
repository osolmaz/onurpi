import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  COMMAND_ENVIRONMENT_EVENT,
  isCommandEnvironmentEvent,
  type CommandEnvironmentEvent,
} from "@onurpi/unified-exec/command-environment";
import piMustWin, { CommitAttributionSession } from "pi-must-win/index.ts";

export { isCommandEnvironmentEvent } from "@onurpi/unified-exec/command-environment";
export { CommitAttributionSession } from "pi-must-win/index.ts";

/** Configuration read from the global Pi Must Win config file. */
export type PiMustWinConfig = {
  /** URL keys such as `github.com/openclaw/openclaw`, or absolute repository paths. */
  disabledRepos: string[];
};

/** Repository identity resolved from a working directory, shared by all its worktrees. */
export type RepoIdentity = {
  /** Normalized remote URL key such as `github.com/openclaw/openclaw`. */
  urlKey: string | undefined;
  /** Absolute path of the main clone, without a trailing `/.git`. */
  repoPath: string | undefined;
};

/** Test and integration overrides for {@link onurPiMustWin}. */
export type OnurPiMustWinOptions = {
  /** Config file path, defaults to {@link DEFAULT_CONFIG_PATH}. */
  configPath?: string;
  /** Working directory used to resolve the repository, defaults to `process.cwd()`. */
  cwd?: string;
  /** Pre-resolved repository identity; skips Git subprocesses when set. */
  identity?: RepoIdentity;
};

/** Resolve the default config path from `XDG_CONFIG_HOME` with a `~/.config` fallback. */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env["XDG_CONFIG_HOME"]?.trim();
  if (configured === undefined || configured === "") {
    return join(homedir(), ".config", "pi-must-win", "config.json");
  }
  return join(configured, "pi-must-win", "config.json");
}

export const DEFAULT_CONFIG_PATH = defaultConfigPath();

/** Parse config file text, falling back to an empty list on malformed input. */
export function parseConfig(text: string): PiMustWinConfig {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { disabledRepos: [] };
  }
  if (typeof value !== "object" || value === null) return { disabledRepos: [] };
  if (!("disabledRepos" in value)) return { disabledRepos: [] };
  const entries: unknown = value.disabledRepos;
  if (!Array.isArray(entries)) return { disabledRepos: [] };
  return { disabledRepos: entries.filter((entry): entry is string => typeof entry === "string") };
}

/** Load the config file, falling back to an empty list when it cannot be read. */
export function loadConfig(path: string): PiMustWinConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { disabledRepos: [] };
  }
  return parseConfig(text);
}

/** Normalize a Git remote URL or URL-like config entry to a `host/path` key. */
export function normalizeRepoUrl(value: string): string {
  let text = value.trim().toLowerCase();
  const hadScheme = /^(https?|ssh|git):\/\//.test(text);
  text = text.replace(/^(https?|ssh|git):\/\//, "");
  text = text.replace(/^[^@/]+@/, "");
  // Scheme URLs keep an explicit port (`host:2222/path`); scp-like syntax uses `host:path`.
  text = hadScheme ? text.replace(/^([^:/]+):\d+(?=\/|$)/, "$1") : text.replace(":", "/");
  text = text.replace(/\/+$/, "");
  text = text.replace(/\.git$/, "");
  return text;
}

function isPathEntry(entry: string): boolean {
  return entry.startsWith("/") || entry.startsWith("~");
}

function normalizeRepoPath(value: string): string {
  let text = value.trim();
  if (text.startsWith("~")) text = join(homedir(), text.slice(1));
  text = text.replace(/\/+$/, "");
  text = text.replace(/\/\.git$/, "");
  return text;
}

function matchesEntry(identity: RepoIdentity, entry: string): boolean {
  if (isPathEntry(entry)) {
    return identity.repoPath !== undefined && normalizeRepoPath(entry) === identity.repoPath;
  }
  if (identity.urlKey === undefined) return false;
  const key = normalizeRepoUrl(entry);
  return key !== "" && (identity.urlKey === key || identity.urlKey.startsWith(`${key}/`));
}

/** Check whether the repository matches a disabled entry; URL entries match path prefixes. */
export function isRepoDisabled(identity: RepoIdentity, config: PiMustWinConfig): boolean {
  return config.disabledRepos.some((entry) => matchesEntry(identity, entry));
}

function git(args: string[], cwd: string): string | undefined {
  try {
    const output = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Resolve the repository identity for a working directory, following worktrees to the main clone. */
export function resolveRepoIdentity(cwd: string): RepoIdentity {
  const remote = git(["remote", "get-url", "origin"], cwd);
  const commonDir = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  return {
    urlKey: remote === undefined ? undefined : normalizeRepoUrl(remote),
    repoPath: commonDir === undefined ? undefined : normalizeRepoPath(commonDir),
  };
}

function modelName(event: CommandEnvironmentEvent): string {
  const model = event.model;
  if (!model) return "unknown";
  if (model.name) return model.name;
  return `${model.provider}/${model.id}`;
}

export function applyCommitAttribution(
  value: unknown,
  session: CommitAttributionSession,
  piVersion: string,
): boolean {
  if (!isCommandEnvironmentEvent(value)) return false;
  value.environment = session.environment(value.environment, modelName(value), piVersion);
  return true;
}

export default function onurPiMustWin(pi: ExtensionAPI, options: OnurPiMustWinOptions = {}): void {
  const config = loadConfig(options.configPath ?? DEFAULT_CONFIG_PATH);
  // Skip Git subprocesses when nothing can be disabled.
  const identity =
    config.disabledRepos.length === 0
      ? { urlKey: undefined, repoPath: undefined }
      : (options.identity ?? resolveRepoIdentity(options.cwd ?? process.cwd()));
  if (isRepoDisabled(identity, config)) return;
  const session = new CommitAttributionSession();
  piMustWin(pi, { commitAttributionSession: session });
  const unsubscribe = pi.events.on(COMMAND_ENVIRONMENT_EVENT, (value) => {
    if (!isCommandEnvironmentEvent(value)) return;
    try {
      applyCommitAttribution(value, session, VERSION);
    } catch (error) {
      value.reject(error);
    }
  });
  pi.on("session_shutdown", () => {
    unsubscribe();
  });
}
