import { describe, expect, it } from "vitest";

import {
  COMMAND_INPUT_EVENT,
  commandInputEvent,
  isCommandInputEvent,
  throwIfCommandInputRejected,
} from "../src/command-input.ts";

describe("command input event", () => {
  it("uses a stable channel and copies bytes", () => {
    const bytes = new Uint8Array([3, 4]);
    const event = commandInputEvent("call-1", 7, "cat", "/repo", "/bin/bash", true, bytes);

    expect(COMMAND_INPUT_EVENT).toBe("unified-exec:before-input");
    expect(event).toMatchObject({
      toolCallId: "call-1",
      sessionId: 7,
      command: "cat",
      cwd: "/repo",
      shell: "/bin/bash",
      tty: true,
    });
    expect(event.bytes).toEqual(bytes);
    expect(event.bytes).not.toBe(bytes);
    expect(isCommandInputEvent(event)).toBe(true);

    event.reject("blocked");
    expect(() => throwIfCommandInputRejected(event)).toThrow(
      "unified-exec: command input rejected: blocked",
    );
  });

  it("rejects malformed event-bus values", () => {
    expect(isCommandInputEvent(undefined)).toBe(false);
    expect(isCommandInputEvent([])).toBe(false);
    expect(
      isCommandInputEvent({
        toolCallId: "call",
        sessionId: 1.5,
        command: "cat",
        cwd: "/repo",
        shell: "bash",
        tty: true,
        bytes: new Uint8Array(),
        reject: () => undefined,
      }),
    ).toBe(false);
    expect(
      isCommandInputEvent({
        toolCallId: "call",
        sessionId: 1,
        command: "cat",
        cwd: "/repo",
        shell: "bash",
        tty: true,
        bytes: [],
        reject: () => undefined,
      }),
    ).toBe(false);
  });
});
