/**
 * Steer interrupt: a queued human steering message ends attached waits early
 * (src/steer-gate.ts, the long wait, and the short collect windows).
 *
 * Unit tests cover the gate. The integration tests drive exec_command and
 * write_stdin against short-lived child processes, with the gate events that
 * Pi would send.
 */

import { strict as assert } from "node:assert";

import { afterEach, describe, it } from "vitest";

import { runExecCommand } from "../src/exec-command.ts";
import { sleep } from "../src/notify.ts";
import { createRuntimeState } from "../src/runtime.ts";
import {
  endedBySteer,
  isNestedToolCall,
  type PendingProbe,
  STEER_INTERRUPT_ENV,
  STEER_NESTED_ERROR,
  STEER_NOTE,
  SteerGate,
  steeredNote,
  steerInterruptEnabled,
  steerSignalFor,
} from "../src/steer-gate.ts";
import { shutdownSessions } from "../src/termination.ts";
import type { ProcessResultDetails } from "../src/tool-result.ts";
import type { ExtensionRuntime } from "../src/tool-types.ts";
import { runWriteStdin } from "../src/write-stdin.ts";

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(10);
  }
  return condition();
}

function probe(queued: () => boolean): PendingProbe {
  return { hasPendingMessages: queued };
}

describe("SteerGate", () => {
  it("confirms a steer against Pi's queue and aborts the shared signal", async () => {
    const gate = new SteerGate();
    const signal = gate.signal;
    gate.onSteerInput(probe(() => true));
    assert.ok(await waitFor(() => signal.aborted));
    assert.equal(gate.pendingCount, 1);
  });

  it("ignores a steer that an input handler dropped", async () => {
    const gate = new SteerGate({ confirmWindowMs: 60 });
    gate.onSteerInput(probe(() => false));
    await sleep(120);
    assert.equal(gate.signal.aborted, false);
    assert.equal(gate.pendingCount, 0);
  });

  it("waits for Pi to queue the steer after the input event", async () => {
    const gate = new SteerGate();
    let queued = false;
    setTimeout(() => (queued = true), 40);
    gate.onSteerInput(probe(() => queued));
    assert.equal(gate.signal.aborted, false);
    assert.ok(await waitFor(() => gate.signal.aborted));
  });

  it("drops a steer whose context throws, for example after a session change", async () => {
    const gate = new SteerGate();
    gate.onSteerInput(
      probe(() => {
        throw new Error("stale context");
      }),
    );
    await sleep(30);
    assert.equal(gate.signal.aborted, false);
  });

  it("re-arms with a fresh signal once every queued steer is delivered", () => {
    const gate = new SteerGate();
    gate.markPending();
    gate.markPending();
    const first = gate.signal;
    gate.onUserMessageDelivered();
    assert.equal(gate.signal, first, "one steer still queued");
    assert.ok(gate.signal.aborted);
    gate.onUserMessageDelivered();
    assert.notEqual(gate.signal, first);
    assert.equal(gate.signal.aborted, false);
    gate.onUserMessageDelivered(); // An ordinary prompt: floored at zero.
    assert.equal(gate.pendingCount, 0);
  });

  it("drops a stale count when Pi's queue is already empty", () => {
    const gate = new SteerGate();
    gate.markPending();
    assert.equal(gate.isPending(probe(() => true)), true);
    assert.equal(gate.isPending(probe(() => false)), false);
    assert.equal(gate.signal.aborted, false);
  });

  it("resets pending steers and confirmations", async () => {
    const gate = new SteerGate();
    gate.markPending();
    gate.onSteerInput(probe(() => true));
    gate.reset();
    await sleep(30);
    assert.equal(gate.pendingCount, 0);
    assert.equal(gate.signal.aborted, false);
  });

  it("never fires when disabled", async () => {
    const gate = new SteerGate({ enabled: false });
    gate.onSteerInput(probe(() => true));
    gate.markPending();
    await sleep(30);
    assert.equal(gate.signal.aborted, false);
    assert.equal(steerInterruptEnabled({ [STEER_INTERRUPT_ENV]: "0" }), false);
    assert.equal(steerInterruptEnabled({ [STEER_INTERRUPT_ENV]: "1" }), true);
    assert.equal(steerInterruptEnabled({}), true);
  });

  it("reacts only to steer input and to delivered user messages", async () => {
    const gate = new SteerGate();
    gate.observeInput(
      { streamingBehavior: "followUp" },
      probe(() => true),
    );
    gate.observeInput(
      {},
      probe(() => true),
    );
    await sleep(30);
    assert.equal(gate.pendingCount, 0);
    gate.observeInput(
      { streamingBehavior: "steer" },
      probe(() => true),
    );
    assert.ok(await waitFor(() => gate.pendingCount === 1));
    gate.observeMessageStart({ message: { role: "assistant" } });
    assert.equal(gate.pendingCount, 1);
    gate.observeMessageStart({ message: { role: "user" } });
    assert.equal(gate.pendingCount, 0);
    assert.equal(gate.signal.aborted, false);
  });

  it("recognizes nested ctx.executeTool() call ids", () => {
    assert.equal(isNestedToolCall("toolu_01/3"), true);
    assert.equal(isNestedToolCall("toolu_01"), false);
  });

  it("gives each call the shared signal and stops nested calls while a steer is queued", () => {
    const gate = new SteerGate();
    assert.equal(
      steerSignalFor(
        gate,
        "toolu_01/2",
        probe(() => false),
      ),
      gate.signal,
    );
    gate.markPending();
    assert.throws(
      () =>
        steerSignalFor(
          gate,
          "toolu_01/2",
          probe(() => true),
        ),
      new Error(STEER_NESTED_ERROR),
    );
    assert.equal(
      steerSignalFor(
        gate,
        "toolu_02",
        probe(() => true),
      )?.aborted,
      true,
    );
    // A stale count is dropped for top-level calls too.
    const fresh = steerSignalFor(
      gate,
      "toolu_03",
      probe(() => false),
    );
    assert.equal(fresh?.aborted, false);
    assert.equal(
      steerSignalFor(
        new SteerGate({ enabled: false }),
        "toolu_04",
        probe(() => true),
      ),
      undefined,
    );
  });

  it("names a steered wait only before its deadline and without Esc", () => {
    const steer = new AbortController();
    const esc = new AbortController();
    const future = Date.now() + 60_000;
    assert.equal(endedBySteer(steer.signal, esc.signal, future), false);
    steer.abort();
    assert.equal(endedBySteer(steer.signal, esc.signal, future), true);
    assert.equal(endedBySteer(steer.signal, undefined, future), true);
    assert.equal(endedBySteer(steer.signal, esc.signal, Date.now() - 1), false);
    esc.abort();
    assert.equal(endedBySteer(steer.signal, esc.signal, future), false);
    assert.equal(endedBySteer(undefined, undefined, future), false);
  });

  it("adds the held-pipe note to the steer note", () => {
    assert.equal(steeredNote(undefined), STEER_NOTE);
    assert.equal(steeredNote("pipe held"), `${STEER_NOTE} Also: pipe held`);
  });
});

// ---------------- integration through exec_command and write_stdin ----------------

const runtimes: ExtensionRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => shutdownSessions(runtime)));
});

type Harness = Readonly<{
  runtime: ExtensionRuntime;
  /** A human steer: Pi's input event, then the message lands in Pi's queue. */
  steer: () => Promise<void>;
  /** Pi delivers one queued message at the next turn. */
  deliver: () => void;
  exec: (cmd: string, yieldMs: number, onExit?: "none" | "wake") => Promise<ProcessResultDetails>;
  poll: (
    sessionId: number,
    wait: Readonly<{ yieldMs?: number; yieldUntil?: string; esc?: AbortSignal }>,
  ) => Promise<ProcessResultDetails>;
  /** An input write with a short window (empty polls wait at least five seconds). */
  write: (sessionId: number, yieldMs: number) => Promise<ProcessResultDetails>;
}>;

function makeHarness(steer = new SteerGate()): Harness {
  let queued = 0;
  const pending = probe(() => queued > 0);
  const runtime = createRuntimeState({ send: () => undefined, steer });
  runtimes.push(runtime);
  let nextId = 1;
  const callId = () => `call-${String(nextId++)}`;
  return {
    runtime,
    steer: async () => {
      runtime.steer.observeInput({ streamingBehavior: "steer" }, pending);
      queued++;
      await waitFor(() => runtime.steer.pendingCount > 0, 200);
    },
    deliver: () => {
      queued = Math.max(0, queued - 1);
      runtime.steer.observeMessageStart({ message: { role: "user" } });
    },
    exec: (cmd, yieldMs, onExit = "none") => {
      const id = callId();
      return runExecCommand(
        runtime,
        { cmd, yield_time_ms: yieldMs, on_exit: onExit },
        undefined,
        undefined,
        process.cwd(),
        id,
        undefined,
        steerSignalFor(runtime.steer, id, pending),
      );
    },
    poll: async (sessionId, wait) => {
      const id = callId();
      const result = await runWriteStdin(
        runtime,
        {
          session_id: sessionId,
          ...(wait.yieldMs === undefined ? {} : { yield_time_ms: wait.yieldMs }),
          ...(wait.yieldUntil === undefined ? {} : { yield_until: wait.yieldUntil }),
        },
        wait.esc,
        undefined,
        id,
        steerSignalFor(runtime.steer, id, pending),
      );
      runtime.coordinator.handleToolExecutionEnd(id, false);
      return result;
    },
    write: (sessionId, yieldMs) => {
      const id = callId();
      return runWriteStdin(
        runtime,
        { session_id: sessionId, chars: "x\n", yield_time_ms: yieldMs },
        undefined,
        undefined,
        id,
        steerSignalFor(runtime.steer, id, pending),
      );
    },
  };
}

const LONG_JOB = `node -e "console.log('job-started'); setTimeout(() => {}, 30000)"`;

async function startLongJob(harness: Harness, onExit: "none" | "wake" = "none"): Promise<number> {
  const result = await harness.exec(LONG_JOB, 300, onExit);
  const sessionId = result.session_id;
  if (sessionId === undefined) throw new Error(`expected a live session: ${result.output}`);
  return sessionId;
}

describe("steer interrupt integration", () => {
  it("ends a long relative empty poll early and keeps the process alive", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness);
    const startedAt = Date.now();
    setTimeout(() => void harness.steer(), 200);
    const result = await harness.poll(sessionId, { yieldMs: 600_000 });
    assert.ok(Date.now() - startedAt < 5000, `took ${String(Date.now() - startedAt)} ms`);
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.session_id, sessionId);
    assert.equal(result.running, true);
    assert.equal(result.note, STEER_NOTE);
    assert.equal(typeof result.effective_wait_ms, "number");
  });

  it("drains output buffered before the steer", async () => {
    const harness = makeHarness();
    const first = await harness.exec(
      `node -e "setTimeout(() => console.log('late-line'), 400); setTimeout(() => {}, 30000)"`,
      250,
    );
    const sessionId = first.session_id;
    if (sessionId === undefined) throw new Error("expected a live session");
    await sleep(700);
    await harness.steer();
    const result = await harness.poll(sessionId, { yieldMs: 600_000 });
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.match(result.output, /late-line/);
  });

  it("returns at once while a steer is queued, then waits normally after delivery", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness);
    await harness.steer();
    const startedAt = Date.now();
    const result = await harness.poll(sessionId, { yieldMs: 600_000 });
    assert.ok(Date.now() - startedAt < 1000);
    assert.equal(result.wait_status, "interrupted_by_steer");

    harness.deliver();
    const startedAfter = Date.now();
    const after = await harness.write(sessionId, 400);
    assert.ok(Date.now() - startedAfter >= 350, "the full window ran after delivery");
    assert.equal(after.wait_status, undefined);
    assert.equal(after.running, true);
  });

  it("releases every parallel wait in the batch", async () => {
    const harness = makeHarness();
    const first = await startLongJob(harness);
    const second = await startLongJob(harness);
    setTimeout(() => void harness.steer(), 150);
    const startedAt = Date.now();
    const results = await Promise.all([
      harness.poll(first, { yieldMs: 600_000 }),
      harness.poll(second, { yieldMs: 600_000 }),
    ]);
    assert.ok(Date.now() - startedAt < 5000);
    for (const result of results) assert.equal(result.wait_status, "interrupted_by_steer");
  });

  it("interrupts an absolute yield_until wait", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness);
    setTimeout(() => void harness.steer(), 150);
    const yieldUntil = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const result = await harness.poll(sessionId, { yieldUntil });
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.wait_mode, "absolute");
  });

  it("keeps an armed wake armed", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness, "wake");
    setTimeout(() => void harness.steer(), 150);
    const result = await harness.poll(sessionId, { yieldMs: 600_000 });
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.completion_notification, "armed");
    assert.equal(harness.runtime.coordinator.isArmed(sessionId), true);
  });

  it("ends the exec_command window early but still returns a live session", async () => {
    const harness = makeHarness();
    setTimeout(() => void harness.steer(), 400);
    const startedAt = Date.now();
    const result = await harness.exec(LONG_JOB, 20_000);
    assert.ok(Date.now() - startedAt < 5000);
    assert.equal(typeof result.session_id, "number");
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.note, STEER_NOTE);
    assert.match(result.output, /job-started/);
  });

  it("ends an input write's window early", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness);
    await harness.steer();
    const startedAt = Date.now();
    const result = await harness.write(sessionId, 20_000);
    assert.ok(Date.now() - startedAt < 2000);
    assert.equal(result.wait_status, "interrupted_by_steer");
    assert.equal(result.running, true);
  });

  it("keeps Esc as a cancellation that drains nothing", async () => {
    const harness = makeHarness();
    const sessionId = await startLongJob(harness);
    const esc = new AbortController();
    setTimeout(() => esc.abort(), 150);
    const result = await harness.poll(sessionId, { yieldMs: 600_000, esc: esc.signal });
    assert.equal(result.wait_status, "cancelled");
  });

  it("does nothing when steer interrupts are disabled", async () => {
    const harness = makeHarness(new SteerGate({ enabled: false }));
    const sessionId = await startLongJob(harness);
    await harness.steer();
    const startedAt = Date.now();
    const result = await harness.write(sessionId, 400);
    assert.ok(Date.now() - startedAt >= 350, "the full window ran");
    assert.equal(result.wait_status, undefined);
  });
});
