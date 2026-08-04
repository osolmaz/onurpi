import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommitAttributionSession } from "pi-must-win/index.ts";
import onurPiMustWin, { applyCommitAttribution, isCommandEnvironmentEvent } from "./index.ts";

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

describe("repository disable gate", () => {
  it("registers nothing when the repository is disabled upstream", () => {
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
});

describe("Pi Must Win adapter", () => {
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
