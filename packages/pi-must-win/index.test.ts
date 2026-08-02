import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommitAttributionSession } from "pi-must-win/index.ts";
import onurPiMustWin, { applyCommitAttribution, isCommandEnvironmentEvent } from "./index.ts";

const sessions: CommitAttributionSession[] = [];

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
});

function session(): CommitAttributionSession {
  const value = new CommitAttributionSession();
  sessions.push(value);
  return value;
}

describe("Pi Must Win adapter", () => {
  it("registers and cleans up the Unified Exec event adapter", () => {
    let environmentHandler: ((value: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const environmentSpy = vi.spyOn(CommitAttributionSession.prototype, "environment");
    const wrapSpy = vi.spyOn(CommitAttributionSession.prototype, "wrap");
    const handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
    const pi = {
      events: {
        emit: vi.fn(),
        on: vi.fn((_channel: string, handler: (value: unknown) => void) => {
          environmentHandler = handler;
          return unsubscribe;
        }),
      },
      exec: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    onurPiMustWin(pi);
    const event = {
      command: "git status",
      cwd: "/repo",
      shell: "bash",
      model: { id: "model-id", name: "", provider: "provider" },
      environment: {},
    };
    environmentHandler?.(event);
    expect(event.environment).toMatchObject({
      PI_MUST_WIN_CO_AUTHOR: "Co-Authored-By: provider/model-id <noreply@pi.dev>",
    });
    handlers.get("tool_call")?.[0]?.(
      { input: { command: "git status" }, toolName: "bash" },
      { model: { id: "model-id", name: "Model Name", provider: "provider" } },
    );
    expect(wrapSpy.mock.instances[0]).toBe(environmentSpy.mock.instances[0]);
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
