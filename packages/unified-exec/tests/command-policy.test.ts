import { describe, expect, it, vi } from "vitest";

import {
  commandEnvironmentEvent,
  throwIfCommandEnvironmentRejected,
} from "../src/command-environment.ts";
import { commandInputEvent, throwIfCommandInputRejected } from "../src/command-input.ts";
import {
  type FinalCommandEnvironmentRequest,
  registerFinalCommandPolicy,
  runFinalInputPolicies,
  runFinalSpawnPolicies,
} from "../src/command-policy.ts";

describe("final command policy", () => {
  it("checks an immutable final spawn snapshot and can reject", () => {
    const checkSpawn = vi.fn((request: FinalCommandEnvironmentRequest) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.environment)).toBe(true);
      expect(request).toMatchObject({
        toolCallId: "call",
        invocationId: "invocation",
        command: "echo safe",
        cwd: "/repo",
        shell: "bash",
        environment: { FINAL: "yes" },
      });
      return "blocked by policy";
    });
    const stop = registerFinalCommandPolicy({ checkSpawn, checkInput: () => undefined });
    const event = commandEnvironmentEvent(
      "call",
      "invocation",
      "echo safe",
      "/repo",
      "bash",
      undefined,
      { FINAL: "yes" },
    );
    runFinalSpawnPolicies(event);
    expect(() => throwIfCommandEnvironmentRejected(event)).toThrow("blocked by policy");
    expect(checkSpawn).toHaveBeenCalledOnce();
    stop();
  });

  it("checks copied final input bytes and contains policy errors", () => {
    const stopReject = registerFinalCommandPolicy({
      checkSpawn: () => undefined,
      checkInput: (request) => {
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.bytes)).toBe(true);
        expect(request.bytes).toEqual([65]);
        return new Error("input blocked");
      },
    });
    const event = commandInputEvent("call", 1, "cat", "/repo", "bash", true, new Uint8Array([65]));
    runFinalInputPolicies(event);
    expect(() => throwIfCommandInputRejected(event)).toThrow("input blocked");
    stopReject();

    const stopThrow = registerFinalCommandPolicy({
      checkSpawn: () => {
        throw new Error("policy failed");
      },
      checkInput: () => undefined,
    });
    const spawn = commandEnvironmentEvent(
      "call",
      "invocation",
      "echo safe",
      "/repo",
      "bash",
      undefined,
      {},
    );
    runFinalSpawnPolicies(spawn);
    expect(() => throwIfCommandEnvironmentRejected(spawn)).toThrow("policy failed");
    stopThrow();
  });

  it("unregisters without affecting other policies", () => {
    const first = vi.fn(() => undefined);
    const second = vi.fn(() => undefined);
    const stopFirst = registerFinalCommandPolicy({ checkSpawn: first, checkInput: first });
    const stopSecond = registerFinalCommandPolicy({ checkSpawn: second, checkInput: second });
    stopFirst();
    const event = commandInputEvent("call", 1, "cat", "/repo", "bash", true, new Uint8Array([3]));
    runFinalInputPolicies(event);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
    stopSecond();
  });
});
