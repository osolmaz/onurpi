import { describe, expect, it } from "vitest";

import {
  parseLauncherInboundMessage,
  parseLauncherOutboundMessage,
  RESTART_PROTOCOL_SCHEMA,
  restartAccepted,
  restartRejected,
  type RestartRequest,
} from "./protocol.ts";

const request: RestartRequest = {
  schema: RESTART_PROTOCOL_SCHEMA,
  type: "restartRequest",
  requestId: "request-1",
  generation: "generation-1",
  sessionFile: "/sessions/one.jsonl",
  sessionId: "session-1",
  cwd: "/repo",
};

describe("restart protocol", () => {
  it("parses valid restart and ready messages", () => {
    expect(parseLauncherInboundMessage(request)).toEqual(request);
    expect(
      parseLauncherInboundMessage({
        schema: RESTART_PROTOCOL_SCHEMA,
        type: "runtimeReady",
        generation: "generation-2",
        sessionFile: "/sessions/one.jsonl",
        sessionId: "session-1",
        cwd: "/repo",
      }),
    ).toMatchObject({ type: "runtimeReady", generation: "generation-2" });
  });

  it.each([
    null,
    [],
    {},
    { ...request, schema: "onurpi-restart-v2" },
    { ...request, requestId: "" },
    { ...request, generation: "x".repeat(129) },
    { ...request, sessionFile: "x".repeat(4097) },
    { ...request, cwd: "/repo\0bad" },
    { ...request, extra: true },
    { ...request, type: "unknown" },
  ])("rejects malformed inbound message %#", (value) => {
    expect(parseLauncherInboundMessage(value)).toBeUndefined();
  });

  it("builds and parses accepted and rejected responses", () => {
    const accepted = restartAccepted(request);
    const rejected = restartRejected(request, "not allowed");
    expect(parseLauncherOutboundMessage(accepted)).toEqual(accepted);
    expect(parseLauncherOutboundMessage(rejected)).toEqual(rejected);
  });

  it("bounds rejection reasons and rejects malformed responses", () => {
    expect(restartRejected(request, "x".repeat(1200)).reason).toHaveLength(1000);
    expect(restartRejected(request, "").reason).toBe("Restart request rejected.");
    expect(
      parseLauncherOutboundMessage({ ...restartAccepted(request), extra: true }),
    ).toBeUndefined();
    expect(
      parseLauncherOutboundMessage({
        ...restartRejected(request, "bad"),
        reason: "x".repeat(1001),
      }),
    ).toBeUndefined();
  });
});
