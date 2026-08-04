import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommitAttributionSession } from "pi-must-win/index.ts";
import onurPiMustWin, {
  DEFAULT_CONFIG_PATH,
  applyCommitAttribution,
  defaultConfigPath,
  isCommandEnvironmentEvent,
  isRepoDisabled,
  loadConfig,
  normalizeRepoUrl,
  parseConfig,
  resolveRepoIdentity,
} from "./index.ts";

const sessions: CommitAttributionSession[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

function session(): CommitAttributionSession {
  const value = new CommitAttributionSession();
  sessions.push(value);
  return value;
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "onurpi-pi-must-win-test-"));
  tempDirs.push(dir);
  return dir;
}

function tempConfig(text: string): string {
  const path = join(tempDir(), "config.json");
  writeFileSync(path, text);
  return path;
}

function missingConfigPath(): string {
  return join(tempDir(), "missing.json");
}

function createMockPi() {
  let environmentHandler: ((value: unknown) => void) | undefined;
  const unsubscribe = vi.fn();
  const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
  const eventsOn = vi.fn((_channel: string, handler: (value: unknown) => void) => {
    environmentHandler = handler;
    return unsubscribe;
  });
  const pi = {
    events: { emit: vi.fn(), on: eventsOn },
    exec: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
  } as unknown as ExtensionAPI;
  return {
    pi,
    handlers,
    eventsOn,
    unsubscribe,
    emitEnvironment: (v: unknown) => environmentHandler?.(v),
  };
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
}

function initRepo(remote?: string): string {
  const dir = tempDir();
  git(["init", "-q", "."], dir);
  if (remote !== undefined) git(["remote", "add", "origin", remote], dir);
  return dir;
}

describe("parseConfig", () => {
  it("returns an empty list for malformed or wrongly shaped input", () => {
    expect(parseConfig("not json")).toEqual({ disabledRepos: [] });
    expect(parseConfig('"text"')).toEqual({ disabledRepos: [] });
    expect(parseConfig("null")).toEqual({ disabledRepos: [] });
    expect(parseConfig("{}")).toEqual({ disabledRepos: [] });
    expect(parseConfig('{"disabledRepos": "github.com/openclaw"}')).toEqual({ disabledRepos: [] });
  });

  it("keeps only string entries", () => {
    expect(parseConfig('{"disabledRepos": ["a", 1, "b", null]}')).toEqual({
      disabledRepos: ["a", "b"],
    });
  });
});

describe("loadConfig", () => {
  it("returns an empty list when the file is missing and parses a present file", () => {
    expect(loadConfig(missingConfigPath())).toEqual({ disabledRepos: [] });
    expect(loadConfig(tempConfig('{"disabledRepos": ["github.com/openclaw"]}'))).toEqual({
      disabledRepos: ["github.com/openclaw"],
    });
  });
});

describe("defaultConfigPath", () => {
  it("honors XDG_CONFIG_HOME and falls back to ~/.config", () => {
    const fallback = join(homedir(), ".config", "pi-must-win", "config.json");
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "/custom" })).toBe(
      join("/custom", "pi-must-win", "config.json"),
    );
    expect(defaultConfigPath({})).toBe(fallback);
    expect(defaultConfigPath({ XDG_CONFIG_HOME: "   " })).toBe(fallback);
    expect(DEFAULT_CONFIG_PATH).toBe(defaultConfigPath());
  });
});

describe("normalizeRepoUrl", () => {
  it("normalizes common remote syntaxes to host/path keys", () => {
    expect(normalizeRepoUrl("git@github.com:OpenClaw/OpenClaw.git")).toBe(
      "github.com/openclaw/openclaw",
    );
    expect(normalizeRepoUrl("https://github.com/openclaw/openclaw/")).toBe(
      "github.com/openclaw/openclaw",
    );
    expect(normalizeRepoUrl("ssh://git@github.com/openclaw/openclaw.git")).toBe(
      "github.com/openclaw/openclaw",
    );
  });

  it("strips explicit ports from scheme URLs", () => {
    expect(normalizeRepoUrl("ssh://git@github.com:2222/OpenClaw/OpenClaw.git")).toBe(
      "github.com/openclaw/openclaw",
    );
  });
});

describe("isRepoDisabled", () => {
  it("matches URL entries exactly and on segment prefixes", () => {
    const identity = { urlKey: "github.com/openclaw/clawhub", repoPath: undefined };
    expect(isRepoDisabled(identity, { disabledRepos: ["github.com/openclaw/clawhub"] })).toBe(true);
    expect(isRepoDisabled(identity, { disabledRepos: ["github.com/openclaw"] })).toBe(true);
    expect(
      isRepoDisabled(identity, { disabledRepos: ["git@github.com:openclaw/clawhub.git"] }),
    ).toBe(true);
    expect(isRepoDisabled(identity, { disabledRepos: ["github.com/open"] })).toBe(false);
    expect(isRepoDisabled(identity, { disabledRepos: ["github.com/otherorg"] })).toBe(false);
    expect(isRepoDisabled(identity, { disabledRepos: [".git"] })).toBe(false);
  });

  it("matches path entries against the main clone path", () => {
    const identity = { urlKey: undefined, repoPath: join(homedir(), "repo") };
    expect(isRepoDisabled(identity, { disabledRepos: ["~/repo"] })).toBe(true);
    expect(isRepoDisabled(identity, { disabledRepos: [`${join(homedir(), "repo")}/`] })).toBe(true);
    expect(isRepoDisabled(identity, { disabledRepos: [join(homedir(), "repo", ".git")] })).toBe(
      true,
    );
    expect(isRepoDisabled(identity, { disabledRepos: [join(homedir(), "other")] })).toBe(false);
    expect(
      isRepoDisabled(
        { urlKey: undefined, repoPath: "/missing/onurpi-test-path" },
        { disabledRepos: ["/missing/onurpi-test-path"] },
      ),
    ).toBe(true);
  });

  it("matches symlinked path entries against the physical clone path", () => {
    const dir = tempDir();
    const link = join(tempDir(), "link");
    symlinkSync(dir, link);
    const identity = { urlKey: undefined, repoPath: realpathSync(dir) };
    expect(isRepoDisabled(identity, { disabledRepos: [link] })).toBe(true);
  });

  it("ignores entries whose identity side is unknown", () => {
    expect(
      isRepoDisabled(
        { urlKey: undefined, repoPath: undefined },
        { disabledRepos: ["github.com/a", "/x"] },
      ),
    ).toBe(false);
    expect(
      isRepoDisabled({ urlKey: undefined, repoPath: "/x" }, { disabledRepos: ["github.com/a"] }),
    ).toBe(false);
  });
});

describe("resolveRepoIdentity", () => {
  it("returns undefined fields outside a Git repository", () => {
    expect(resolveRepoIdentity(tempDir())).toEqual({ urlKey: undefined, repoPath: undefined });
  });

  it("resolves the clone path without a remote", () => {
    const dir = initRepo();
    expect(resolveRepoIdentity(dir)).toEqual({ urlKey: undefined, repoPath: realpathSync(dir) });
  });

  it("normalizes the origin URL and treats an empty URL as missing", () => {
    const dir = initRepo("git@github.com:OpenClaw/OpenClaw.git");
    expect(resolveRepoIdentity(dir)).toEqual({
      urlKey: "github.com/openclaw/openclaw",
      repoPath: realpathSync(dir),
    });
    const emptyRemote = initRepo("");
    expect(resolveRepoIdentity(emptyRemote).urlKey).toBeUndefined();
  });

  it("resolves a linked worktree to the main clone path", () => {
    const dir = initRepo("https://github.com/osolmaz/onurpi.git");
    git(
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "init"],
      dir,
    );
    const linked = join(tempDir(), "linked");
    git(["worktree", "add", "-q", linked], dir);
    const main = resolveRepoIdentity(dir);
    const fromWorktree = resolveRepoIdentity(linked);
    expect(fromWorktree.urlKey).toBe("github.com/osolmaz/onurpi");
    expect(fromWorktree.repoPath).toBe(main.repoPath);
    expect(fromWorktree.repoPath).not.toBe(linked);
  });
});

describe("Pi Must Win adapter", () => {
  it("registers nothing when the repository is disabled", () => {
    const { pi, handlers, eventsOn } = createMockPi();
    const configPath = tempConfig('{"disabledRepos": ["github.com/openclaw"]}');
    onurPiMustWin(pi, {
      configPath,
      identity: { urlKey: "github.com/openclaw/clawhub", repoPath: undefined },
    });
    expect(handlers.size).toBe(0);
    expect(eventsOn).not.toHaveBeenCalled();
  });

  it("resolves identity from an explicit cwd and stays enabled outside Git", () => {
    const { pi, handlers } = createMockPi();
    const configPath = tempConfig('{"disabledRepos": ["github.com/otherorg"]}');
    onurPiMustWin(pi, { configPath, cwd: tempDir() });
    expect(handlers.has("tool_call")).toBe(true);
  });

  it("skips repository checks when no repos are disabled", () => {
    const { pi, handlers } = createMockPi();
    onurPiMustWin(pi, { configPath: tempConfig('{"disabledRepos": []}'), cwd: tempDir() });
    expect(handlers.has("tool_call")).toBe(true);
  });

  it("resolves identity from the process cwd and the default config path", () => {
    const withCwdDefault = createMockPi();
    const configPath = tempConfig('{"disabledRepos": ["github.com/otherorg"]}');
    onurPiMustWin(withCwdDefault.pi, { configPath });
    expect(withCwdDefault.handlers.has("tool_call")).toBe(true);

    const withConfigDefault = createMockPi();
    onurPiMustWin(withConfigDefault.pi, {
      identity: { urlKey: undefined, repoPath: undefined },
    });
    expect(withConfigDefault.handlers.has("tool_call")).toBe(true);
  });

  it("registers and cleans up the Unified Exec event adapter", () => {
    const environmentSpy = vi.spyOn(CommitAttributionSession.prototype, "environment");
    const wrapSpy = vi.spyOn(CommitAttributionSession.prototype, "wrap");
    const { pi, handlers, unsubscribe, emitEnvironment } = createMockPi();

    onurPiMustWin(pi, {
      configPath: missingConfigPath(),
      identity: { urlKey: undefined, repoPath: undefined },
    });
    emitEnvironment(undefined);
    const event = {
      command: "git status",
      cwd: "/repo",
      shell: "bash",
      model: { id: "model-id", name: "", provider: "provider" },
      environment: {},
      reject: vi.fn(),
    };
    emitEnvironment(event);
    expect(event.environment).toMatchObject({
      PI_MUST_WIN_CO_AUTHOR: "Co-Authored-By: provider/model-id <noreply@pi.dev>",
    });
    handlers.get("tool_call")?.[0]?.(
      { input: { command: "git status" }, toolName: "bash" },
      { model: { id: "model-id", name: "Model Name", provider: "provider" } },
    );
    expect(wrapSpy.mock.instances[0]).toBe(environmentSpy.mock.instances[0]);

    const failure = new Error("attribution failed");
    environmentSpy.mockImplementationOnce(() => {
      throw failure;
    });
    const rejectedEvent = { ...event, environment: {}, reject: vi.fn() };
    emitEnvironment(rejectedEvent);
    expect(rejectedEvent.reject).toHaveBeenCalledWith(failure);

    for (const handler of handlers.get("session_shutdown") ?? []) handler();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("validates and attributes Unified Exec environment events", () => {
    const event = {
      command: "git commit -m test",
      cwd: "/repo",
      shell: "/bin/bash",
      model: { id: "model-id", name: "Model Name", provider: "provider" },
      environment: { KEEP_ME: "yes" },
      reject: vi.fn(),
    };

    expect(isCommandEnvironmentEvent(event)).toBe(true);
    expect(applyCommitAttribution(event, session(), "0.83.0")).toBe(true);
    expect(event.environment).toMatchObject({
      KEEP_ME: "yes",
      PI_MUST_WIN_CO_AUTHOR: "Co-Authored-By: Model Name <noreply@pi.dev>",
      PI_MUST_WIN_GENERATED_BY: "Generated-By: pi 0.83.0 (https://pi.dev)",
    });

    const unknownModel = { ...event, model: undefined, environment: {} };
    const unknownSession = session();
    const environmentSpy = vi.spyOn(unknownSession, "environment");
    expect(applyCommitAttribution(unknownModel, unknownSession, "0.83.0")).toBe(true);
    expect(environmentSpy).toHaveBeenCalledWith({}, "unknown", "0.83.0");
    expect(unknownModel.environment).toMatchObject({
      PI_MUST_WIN_CO_AUTHOR: "Co-Authored-By: unknown <noreply@pi.dev>",
    });
  });

  it("rejects malformed event-bus values", () => {
    const attribution = session();
    expect(applyCommitAttribution(undefined, attribution, "0.83.0")).toBe(false);
    expect(
      applyCommitAttribution(
        { command: "git status", cwd: "/repo", shell: "bash", environment: { BAD: 1 } },
        attribution,
        "0.83.0",
      ),
    ).toBe(false);
  });
});
