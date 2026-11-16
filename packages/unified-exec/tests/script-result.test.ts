/**
 * Structured results for Pi codemode (src/script-result.ts): every projection
 * matches the output schema that its tool declares, keeps real newlines in
 * `output`, holds no undefined field, and carries only bounded, single-line
 * metadata.
 */

import { strict as assert } from "node:assert";

import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import { describe, it } from "vitest";

import {
  killNotFoundScriptResult,
  killScriptResult,
  killScriptResultSchema,
  listSessionsScriptResult,
  listSessionsScriptResultSchema,
  processScriptResult,
  processScriptResultSchema,
  setOnExitScriptResult,
  setOnExitScriptResultSchema,
} from "../src/script-result.ts";
import {
  finalizeKillResult,
  finalizeProcessResult,
  type FinalizeProcessInput,
} from "../src/tool-result.ts";
import type { SessionListing } from "../src/tool-types.ts";

const encoder = new TextEncoder();

function assertConforms(schema: TSchema, value: unknown): void {
  assert.ok(Value.Check(schema, value), JSON.stringify([...Value.Errors(schema, value)]));
  // Plain JSON: no undefined field, and a JSON round trip changes nothing.
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function processInput(overrides: Partial<FinalizeProcessInput> = {}): FinalizeProcessInput {
  return {
    operation: "write_stdin",
    wallTimeSec: 0.5,
    collected: encoder.encode("line 1\nline 2\n"),
    sessionId: undefined,
    exitCode: 0,
    signal: null,
    failure: null,
    tty: false,
    logPath: "/tmp/pi-unified-exec-1-abc.log",
    cwd: "/work",
    command: "echo hi",
    ...overrides,
  };
}

describe("processScriptResult", () => {
  it("gives an exited result with real newlines in output", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `line ${String(index + 1)}`);
    const details = finalizeProcessResult(
      processInput({ collected: encoder.encode(`${lines.join("\n")}\n`) }),
    );
    const result = processScriptResult(details);
    assertConforms(processScriptResultSchema, result);
    assert.equal(result.status, "exited");
    assert.equal(result.running, false);
    assert.equal(result.exit_code, 0);
    assert.equal(result.session_id, undefined);
    assert.equal(result.truncated, false);
    assert.equal(result.output.split("\n").length, 41);
    assert.equal(result.log_path, "/tmp/pi-unified-exec-1-abc.log");
  });

  it("gives a running result with its wait state", () => {
    const details = finalizeProcessResult(
      processInput({
        sessionId: 7,
        exitCode: undefined,
        extra: {
          wait_mode: "relative",
          wait_status: "interrupted_by_steer",
          on_exit: "wake",
          completion_notification: "armed",
          tool_time_utc: "2026-11-16T12:00:00.000Z",
          note: "returned early",
        },
      }),
    );
    const result = processScriptResult(details);
    assertConforms(processScriptResultSchema, result);
    assert.equal(result.status, "running");
    assert.equal(result.session_id, 7);
    assert.equal(result.exit_code, undefined);
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.on_exit, "wake");
    assert.equal(result.note, "returned early");
    assert.equal(result.tool_time_utc, "2026-11-16T12:00:00.000Z");
  });

  it("gives a signalled and failed result with bounded single-line metadata", () => {
    const details = finalizeProcessResult(
      processInput({
        exitCode: null,
        signal: "SIGTERM",
        failure: "spawn failed\n\u001b[31mred\u001b[0m",
        logPath: undefined,
      }),
    );
    const result = processScriptResult(details);
    assertConforms(processScriptResultSchema, result);
    assert.equal(result.signal, "SIGTERM");
    assert.equal(result.exit_code, undefined);
    assert.equal(result.log_path, undefined);
    assert.doesNotMatch(result.failure_message ?? "", /[\n\u001b]/);
  });

  it("marks truncated output and the omitted middle", () => {
    const big = `${"x".repeat(120)}\n`.repeat(1000);
    const details = finalizeProcessResult(
      processInput({ collected: encoder.encode(big), omittedBytes: 4096 }),
    );
    const result = processScriptResult(details);
    assertConforms(processScriptResultSchema, result);
    assert.equal(result.truncated, true);
    assert.equal(result.omitted_bytes, 4096);
  });

  it("strips terminal control sequences from output", () => {
    const details = finalizeProcessResult(
      processInput({ collected: encoder.encode("\u001b]52;c;aGk=\u0007plain\n") }),
    );
    const result = processScriptResult(details);
    assertConforms(processScriptResultSchema, result);
    assert.doesNotMatch(result.output, /\u001b/);
    assert.match(result.output, /plain/);
  });
});

describe("killScriptResult", () => {
  const killInput = {
    wallTimeSec: 0.2,
    collected: encoder.encode("bye\n"),
    sessionId: 3,
    pid: 1234,
    requestedSignal: "SIGTERM" as const,
    exitCode: null,
    signal: "SIGTERM" as const,
    failure: null,
    tty: false,
    logPath: "/tmp/pi-unified-exec-3-abc.log",
    escalated: false,
    killed: true,
  };

  it("gives a killed result", () => {
    const result = killScriptResult(finalizeKillResult(killInput));
    assertConforms(killScriptResultSchema, result);
    assert.equal(result.status, "killed");
    assert.equal(result.found, true);
    assert.equal(result.killed, true);
    assert.equal(result.running, false);
    assert.equal(result.session_id, 3);
    assert.equal(result.output, "bye\n");
  });

  it("gives a failed kill result", () => {
    const result = killScriptResult(
      finalizeKillResult({
        ...killInput,
        signal: null,
        killed: false,
        escalated: true,
        failure: "still running",
      }),
    );
    assertConforms(killScriptResultSchema, result);
    assert.equal(result.status, "kill_failed");
    assert.equal(result.running, true);
    assert.equal(result.escalated, true);
    assert.equal(result.failure_message, "still running");
  });

  it("gives a not-found result", () => {
    const result = killNotFoundScriptResult(99);
    assertConforms(killScriptResultSchema, result);
    assert.equal(result.found, false);
    assert.equal(result.session_id, 99);
  });
});

describe("setOnExitScriptResult", () => {
  it("gives found and not-found results", () => {
    const found = setOnExitScriptResult({
      session_id: 2,
      found: true,
      on_exit: "none",
      status: "disarmed",
      running: true,
      wake_armed: false,
    });
    assertConforms(setOnExitScriptResultSchema, found);
    assert.equal(found.status, "disarmed");

    const missing = setOnExitScriptResult({ session_id: 5, found: false });
    assertConforms(setOnExitScriptResultSchema, missing);
    assert.deepEqual(missing, { session_id: 5, found: false });
  });
});

describe("listSessionsScriptResult", () => {
  const base: SessionListing = {
    session_id: 1,
    command: "npm run dev\n\u001b[2J",
    cwd: "/work",
    tty: true,
    pid: 4321,
    started_at_ms: 0,
    elapsed_ms: 1500,
    running: true,
    wake_armed: true,
    output_bytes_total: 10,
    log_path: "/tmp/pi-unified-exec-1-abc.log",
  };

  it("lists live and just-exited sessions", () => {
    const exited: SessionListing = {
      ...base,
      session_id: 2,
      running: false,
      wake_armed: false,
      exit_code: null,
      signal: "SIGTERM",
    };
    const result = listSessionsScriptResult({
      sessions: [base, exited],
      active_count: 1,
      just_exited_count: 1,
      tool_time_utc: "2026-11-16T12:00:00.000Z",
    });
    assertConforms(listSessionsScriptResultSchema, result);
    assert.equal(result.sessions.length, 2);
    assert.doesNotMatch(result.sessions[0]?.command ?? "", /[\n\u001b]/);
    assert.equal(result.sessions[1]?.exit_code, undefined);
    assert.equal(result.sessions[1]?.signal, "SIGTERM");
  });
});
