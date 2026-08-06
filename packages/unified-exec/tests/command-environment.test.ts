import { describe, expect, it } from "vitest";

import {
  COMMAND_ENVIRONMENT_EVENT,
  commandEnvironmentEvent,
  isCommandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
} from "../src/command-environment.ts";

describe("command environment event", () => {
  it("uses a stable channel and copies the child environment", () => {
    const baseEnvironment: NodeJS.ProcessEnv = { KEEP_ME: "yes" };
    const event = commandEnvironmentEvent(
      "git status",
      "/repo",
      "/bin/bash",
      { id: "model-id", name: "Model Name", provider: "provider" },
      baseEnvironment,
    );

    expect(COMMAND_ENVIRONMENT_EVENT).toBe("unified-exec:before-spawn");
    expect(event).toMatchObject({
      command: "git status",
      cwd: "/repo",
      shell: "/bin/bash",
      model: { id: "model-id", name: "Model Name", provider: "provider" },
      environment: { KEEP_ME: "yes" },
    });
    expect(typeof event.reject).toBe("function");
    event.environment["ADDED"] = "true";
    expect(baseEnvironment).toEqual({ KEEP_ME: "yes" });
    expect(isCommandEnvironmentEvent(event)).toBe(true);

    const failure = new Error("policy failed");
    event.reject(failure);
    expect(() => throwIfCommandEnvironmentRejected(event)).toThrow(failure);

    const stringRejected = commandEnvironmentEvent("git status", "/repo", "bash", undefined, {});
    stringRejected.reject("blocked");
    expect(() => throwIfCommandEnvironmentRejected(stringRejected)).toThrow(
      "unified-exec: child environment rejected: blocked",
    );
  });

  it("rejects malformed event-bus values", () => {
    expect(isCommandEnvironmentEvent(undefined)).toBe(false);
    expect(isCommandEnvironmentEvent([])).toBe(false);
    expect(
      isCommandEnvironmentEvent({
        command: "git status",
        cwd: "/repo",
        shell: "bash",
        model: { id: "id", name: 1, provider: "provider" },
        environment: {},
        reject: () => undefined,
      }),
    ).toBe(false);
    expect(
      isCommandEnvironmentEvent({
        command: "git status",
        cwd: "/repo",
        shell: "bash",
        model: undefined,
        environment: { BAD: 1 },
        reject: () => undefined,
      }),
    ).toBe(false);
    expect(
      isCommandEnvironmentEvent({
        command: "git status",
        cwd: "/repo",
        shell: "bash",
        model: undefined,
        environment: {},
      }),
    ).toBe(false);
  });
});
