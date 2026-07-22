import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

import { afterEach, describe, it } from "vitest";

import type { WakeMessage } from "../src/completion.ts";
import { runExecCommand } from "../src/exec-command.ts";
import { isPtyAvailable } from "../src/pty.ts";
import { createRuntimeState } from "../src/runtime.ts";
import { sleep } from "../src/notify.ts";
import { shutdownSessions, terminateSessionById } from "../src/termination.ts";
import type { ExtensionRuntime, FinalResponseDetails } from "../src/tool-types.ts";
import { runWriteStdin } from "../src/write-stdin.ts";

const runtimes: ExtensionRuntime[] = [];

function makeRuntime(): { runtime: ExtensionRuntime; messages: WakeMessage[] } {
  const messages: WakeMessage[] = [];
  const runtime = createRuntimeState({
    send: (message) => {
      messages.push(message);
    },
    coordinator: { debounceMs: 5 },
  });
  runtimes.push(runtime);
  return { runtime, messages };
}

function delayedOutput(delayMs: number, output = "done"): string {
  return `node -e "setTimeout(()=>{console.log('${output}')},${String(delayMs)})"`;
}

function requireSessionId(result: FinalResponseDetails): number {
  const sessionId = result.session_id;
  if (sessionId === undefined) throw new Error("expected a background session_id");
  return sessionId;
}

async function start(
  runtime: ExtensionRuntime,
  command: string,
  options: Readonly<{ onExit?: "none" | "wake"; tty?: boolean; yieldMs?: number }> = {},
): Promise<FinalResponseDetails> {
  return runExecCommand(
    runtime,
    {
      cmd: command,
      on_exit: options.onExit ?? "none",
      tty: options.tty ?? false,
      yield_time_ms: options.yieldMs ?? 250,
    },
    undefined,
    undefined,
    process.cwd(),
  );
}

async function poll(
  runtime: ExtensionRuntime,
  sessionId: number,
  toolCallId = `poll-${String(sessionId)}`,
  yieldMs = 2000,
): Promise<FinalResponseDetails> {
  const result = await runWriteStdin(
    runtime,
    { session_id: sessionId, yield_time_ms: yieldMs },
    undefined,
    undefined,
    toolCallId,
  );
  runtime.coordinator.handleToolExecutionEnd(toolCallId, false);
  return result;
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => shutdownSessions(runtime)));
});

describe("runtime integration", () => {
  it("returns a terminal result without registering a quick process", async () => {
    const { runtime } = makeRuntime();
    const result = await start(runtime, "node -e \"console.log('quick')\"");
    assert.equal(result.session_id, undefined);
    assert.equal(result.exit_code, 0);
    assert.match(result.output, /quick/);
    assert.equal(runtime.store.size, 0);
  });

  it("backgrounds a long process and observes its final result directly", async () => {
    const { runtime } = makeRuntime();
    const started = await start(runtime, delayedOutput(600));
    const sessionId = requireSessionId(started);
    const result = await poll(runtime, sessionId);
    assert.equal(result.session_id, undefined);
    assert.equal(result.exit_code, 0);
    assert.match(result.output, /done/);
    assert.equal(runtime.store.size, 0);
  });

  it("decodes C-style characters before writing to stdin", async () => {
    const { runtime } = makeRuntime();
    const command =
      "node -e \"process.stdin.once('data',d=>{console.log(d.toString('hex'));process.exit(0)});setTimeout(()=>{},5000)\"";
    const sessionId = requireSessionId(await start(runtime, command));
    const result = await runWriteStdin(
      runtime,
      { session_id: sessionId, chars: "A\\n\\x03", yield_time_ms: 2000 },
      undefined,
      undefined,
      "chars",
    );
    runtime.coordinator.handleToolExecutionEnd("chars", false);
    assert.match(result.output, /410a03/);
  });

  it("writes raw base64 bytes", async () => {
    const { runtime } = makeRuntime();
    const command =
      "node -e \"process.stdin.once('data',d=>{console.log(d.toString('hex'));process.exit(0)});setTimeout(()=>{},5000)\"";
    const sessionId = requireSessionId(await start(runtime, command));
    const result = await runWriteStdin(
      runtime,
      {
        session_id: sessionId,
        chars_b64: Buffer.from([0, 255, 10]).toString("base64"),
        yield_time_ms: 2000,
      },
      undefined,
      undefined,
      "base64",
    );
    runtime.coordinator.handleToolExecutionEnd("base64", false);
    assert.match(result.output, /00ff0a/);
  });

  it("rejects simultaneous chars and chars_b64", async () => {
    const { runtime } = makeRuntime();
    const sessionId = requireSessionId(await start(runtime, delayedOutput(2000)));
    await assert.rejects(
      runWriteStdin(
        runtime,
        { session_id: sessionId, chars: "x", chars_b64: "eA==" },
        undefined,
        undefined,
        "invalid-input",
      ),
      /either `chars` or `chars_b64`/,
    );
  });

  it("sends an idle wake exactly once", async () => {
    const { runtime, messages } = makeRuntime();
    requireSessionId(await start(runtime, delayedOutput(450), { onExit: "wake" }));
    await sleep(500);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.details.sessions.length, 1);
    assert.match(messages[0]?.content ?? "", /\[unified-exec\]/);
  });

  it("defers active-run wakes until agent_settled", async () => {
    const { runtime, messages } = makeRuntime();
    runtime.agentActivity.active = true;
    requireSessionId(await start(runtime, delayedOutput(450), { onExit: "wake" }));
    await sleep(500);
    assert.equal(messages.length, 0);
    runtime.agentActivity.active = false;
    runtime.coordinator.flushPending();
    await sleep(20);
    assert.equal(messages.length, 1);
  });

  it("lets direct observation consume an active-run completion before settlement", async () => {
    const { runtime, messages } = makeRuntime();
    runtime.agentActivity.active = true;
    const sessionId = requireSessionId(
      await start(runtime, delayedOutput(450), { onExit: "wake" }),
    );
    await sleep(500);
    assert.equal(messages.length, 0);
    const result = await poll(runtime, sessionId, "race-observer");
    assert.equal(result.on_exit_wake, "consumed");
    runtime.agentActivity.active = false;
    runtime.coordinator.flushPending();
    await sleep(20);
    assert.equal(messages.length, 0);
  });

  it("keeps a completion wake eligible when direct observation is reported as an error", async () => {
    const { runtime, messages } = makeRuntime();
    runtime.agentActivity.active = true;
    const sessionId = requireSessionId(
      await start(runtime, delayedOutput(450), { onExit: "wake" }),
    );
    await sleep(500);
    const result = await runWriteStdin(
      runtime,
      { session_id: sessionId, yield_time_ms: 1000 },
      undefined,
      undefined,
      "failed-observer",
    );
    assert.equal(result.session_id, undefined);
    runtime.coordinator.handleToolExecutionEnd("failed-observer", true);
    runtime.agentActivity.active = false;
    runtime.coordinator.flushPending();
    await sleep(20);
    assert.equal(messages.length, 1);
  });

  it("disarms wake without terminating the process", async () => {
    const { runtime, messages } = makeRuntime();
    const sessionId = requireSessionId(
      await start(runtime, delayedOutput(450), { onExit: "wake" }),
    );
    assert.equal(runtime.coordinator.setOnExit(sessionId, "none"), "disarmed");
    assert.equal(runtime.store.get(sessionId)?.hasExited, false);
    await sleep(500);
    assert.equal(messages.length, 0);
  });

  it("suppresses wake when a process is killed", async () => {
    const { runtime, messages } = makeRuntime();
    const sessionId = requireSessionId(
      await start(runtime, delayedOutput(5000), { onExit: "wake" }),
    );
    const outcome = await terminateSessionById(runtime, sessionId, "SIGTERM");
    assert.equal(outcome?.killed, true);
    await sleep(20);
    assert.equal(messages.length, 0);
  });

  it("returns at an absolute deadline while the process keeps running", async () => {
    const { runtime } = makeRuntime();
    const sessionId = requireSessionId(await start(runtime, delayedOutput(2000)));
    const deadline = new Date(Date.now() + 150).toISOString();
    const result = await runWriteStdin(
      runtime,
      { session_id: sessionId, yield_until: deadline },
      undefined,
      undefined,
      "absolute-deadline",
    );
    assert.equal(result.session_id, sessionId);
    assert.equal(result.wait_status, "absolute_deadline_reached");
  });

  it("returns completion before a later absolute deadline", async () => {
    const { runtime } = makeRuntime();
    const sessionId = requireSessionId(await start(runtime, delayedOutput(450)));
    const result = await runWriteStdin(
      runtime,
      { session_id: sessionId, yield_until: new Date(Date.now() + 3000).toISOString() },
      undefined,
      undefined,
      "absolute-completion",
    );
    runtime.coordinator.handleToolExecutionEnd("absolute-completion", false);
    assert.equal(result.session_id, undefined);
    assert.equal(result.wait_status, "completed");
  });

  it("cancels an absolute wait without draining output", async () => {
    const { runtime } = makeRuntime();
    const sessionId = requireSessionId(await start(runtime, delayedOutput(2000)));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await runWriteStdin(
      runtime,
      { session_id: sessionId, yield_until: new Date(Date.now() + 3000).toISOString() },
      controller.signal,
      undefined,
      "absolute-cancel",
    );
    assert.equal(result.session_id, sessionId);
    assert.equal(result.wait_status, "cancelled");
    assert.equal(result.output, "");
  });

  it("keeps full output in the per-session log", async () => {
    const { runtime } = makeRuntime();
    const command = "node -e \"setTimeout(()=>{console.log('z'.repeat(100000))},450)\"";
    const sessionId = requireSessionId(await start(runtime, command));
    const result = await poll(runtime, sessionId);
    assert.equal(result.truncation?.truncated, true);
    assert.ok(result.log_path);
    const log = await readFile(result.log_path, "utf8");
    assert.ok(log.length >= 100_000);
  });

  it.skipIf(!isPtyAvailable())(
    "supports TTY sessions when the optional provider loads",
    async () => {
      const { runtime } = makeRuntime();
      const result = await start(runtime, delayedOutput(450, "pty-ok"), { tty: true });
      const sessionId = requireSessionId(result);
      const terminal = await poll(runtime, sessionId);
      assert.match(terminal.output, /pty-ok/);
      assert.equal(terminal.tty, true);
    },
  );
});
