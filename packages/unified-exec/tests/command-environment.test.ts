import { describe, expect, it } from "vitest";

import {
  COMMAND_ENVIRONMENT_EVENT,
  commandEnvironmentEvent,
  isCommandEnvironmentEvent,
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
    expect(event).toEqual({
      command: "git status",
      cwd: "/repo",
      shell: "/bin/bash",
      model: { id: "model-id", name: "Model Name", provider: "provider" },
      environment: { KEEP_ME: "yes" },
    });
    event.environment["ADDED"] = "true";
    expect(baseEnvironment).toEqual({ KEEP_ME: "yes" });
    expect(isCommandEnvironmentEvent(event)).toBe(true);
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
      }),
    ).toBe(false);
    expect(
      isCommandEnvironmentEvent({
        command: "git status",
        cwd: "/repo",
        shell: "bash",
        model: undefined,
        environment: { BAD: 1 },
      }),
    ).toBe(false);
  });
});
