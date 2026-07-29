/**
 * Unit tests for the event-driven absolute wait (src/long-wait.ts).
 * Uses injected monotonic clocks / timers where determinism matters; real
 * waits are all sub-second.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { MAX_TIMER_ARM_MS, startRateLimitedStream, waitForExitOrDeadline } from "../src/long-wait.ts";
import { Notify } from "../src/notify.ts";

describe("waitForExitOrDeadline", () => {
	it("returns 'exit' immediately when the process already exited", async () => {
		const exited = new AbortController();
		exited.abort();
		assert.equal(await waitForExitOrDeadline({ exited: exited.signal, durationMs: 60_000 }), "exit");
	});

	it("returns 'cancelled' immediately when already aborted", async () => {
		const exited = new AbortController();
		const external = new AbortController();
		external.abort();
		assert.equal(
			await waitForExitOrDeadline({ exited: exited.signal, externalAbort: external.signal, durationMs: 60_000 }),
			"cancelled",
		);
	});

	it("returns 'deadline' immediately for a non-positive duration (past yield_until)", async () => {
		const exited = new AbortController();
		assert.equal(await waitForExitOrDeadline({ exited: exited.signal, durationMs: 0 }), "deadline");
		assert.equal(await waitForExitOrDeadline({ exited: exited.signal, durationMs: -100 }), "deadline");
	});

	it("process exit before the deadline resolves promptly with 'exit'", async () => {
		const exited = new AbortController();
		const t0 = Date.now();
		setTimeout(() => exited.abort(), 50);
		const outcome = await waitForExitOrDeadline({ exited: exited.signal, durationMs: 60_000 });
		assert.equal(outcome, "exit");
		assert.ok(Date.now() - t0 < 5_000, "should not have waited for the deadline");
	});

	it("deadline arrives first while the process keeps running", async () => {
		const exited = new AbortController();
		const outcome = await waitForExitOrDeadline({ exited: exited.signal, durationMs: 60 });
		assert.equal(outcome, "deadline");
		assert.equal(exited.signal.aborted, false, "the wait must not touch the process");
	});

	it("external cancellation resolves promptly and does not signal the process", async () => {
		const exited = new AbortController();
		const external = new AbortController();
		setTimeout(() => external.abort(), 50);
		const outcome = await waitForExitOrDeadline({
			exited: exited.signal,
			externalAbort: external.signal,
			durationMs: 60_000,
		});
		assert.equal(outcome, "cancelled");
		assert.equal(exited.signal.aborted, false);
	});

	it("chunks multi-day waits below the setTimeout overflow ceiling", async () => {
		let mono = 0;
		const armed: number[] = [];
		const exited = new AbortController();
		// 3× MAX_TIMER_ARM_MS requires at least 3 arms; each arm advances mono to the
		// requested deadline chunk so the wait progresses without real multi-day delays.
		const outcome = await waitForExitOrDeadline({
			exited: exited.signal,
			durationMs: MAX_TIMER_ARM_MS * 3,
			monotonicNow: () => mono,
			setTimeoutFn: (cb, ms) => {
				armed.push(ms as number);
				mono += ms as number;
				return setTimeout(cb, 0);
			},
			clearTimeoutFn: (h) => clearTimeout(h as NodeJS.Timeout),
		});
		assert.equal(outcome, "deadline");
		assert.ok(armed.length >= 3, `expected >=3 arms; got ${armed.length}`);
		assert.ok(
			armed.every((ms) => ms <= MAX_TIMER_ARM_MS),
			`every arm must be ≤ MAX_TIMER_ARM_MS; got ${armed.join(",")}`,
		);
	});

	it("runs on the monotonic clock: an early timer fire re-arms instead of ending the wait", async () => {
		// Simulate coarse/foul timers: the injected setTimeout always fires
		// almost immediately, but the injected monotonic clock only advances a
		// little per fire — the wait must re-arm until the monotonic deadline
		// is genuinely reached, and must not consult the wall clock at all.
		let mono = 1000;
		let fires = 0;
		const exited = new AbortController();
		const outcome = await waitForExitOrDeadline({
			exited: exited.signal,
			durationMs: 500,
			monotonicNow: () => mono,
			setTimeoutFn: (cb, _ms) => {
				fires++;
				mono += 200; // each fire advances monotonic time by only 200ms
				return setTimeout(cb, 1);
			},
			clearTimeoutFn: (h) => clearTimeout(h as NodeJS.Timeout),
		});
		assert.equal(outcome, "deadline");
		assert.ok(fires >= 3, `expected >=3 re-arms; got ${fires}`); // 500/200 → 3 fires
	});

	it("cleans up timers and listeners on every outcome", async () => {
		const cleared: unknown[] = [];
		const exited = new AbortController();
		setTimeout(() => exited.abort(), 30);
		await waitForExitOrDeadline({
			exited: exited.signal,
			durationMs: 60_000,
			setTimeoutFn: (cb, ms) => setTimeout(cb, ms),
			clearTimeoutFn: (h) => {
				cleared.push(h);
				clearTimeout(h as NodeJS.Timeout);
			},
		});
		assert.ok(cleared.length >= 1, "pending deadline timer must be cleared on exit");

		// Deadline outcome: the abort listener registered on `exited` must be
		// removed — a later abort produces no unhandled effects.
		const exited2 = new AbortController();
		await waitForExitOrDeadline({ exited: exited2.signal, durationMs: 20 });
		exited2.abort(); // must be inert
	});
});

describe("startRateLimitedStream", () => {
	it("emits initial + final updates, and rate-limits output-driven updates", async () => {
		const notify = new Notify();
		let emits = 0;
		const stream = startRateLimitedStream({
			outputNotify: notify,
			emit: () => emits++,
			minIntervalMs: 10_000, // effectively "never twice" within this test
		});
		assert.equal(emits, 1, "one initial waiting update");

		// A noisy burst must NOT produce one update per chunk.
		for (let i = 0; i < 50; i++) {
			notify.notifyAll();
			await new Promise((r) => setImmediate(r));
		}
		assert.ok(emits <= 2, `burst should be coalesced; got ${emits} emits`);

		stream.stop();
		const afterStop = emits;
		assert.ok(afterStop >= 2, "final update on stop");
		notify.notifyAll();
		await new Promise((r) => setTimeout(r, 20));
		assert.equal(emits, afterStop, "no emissions after stop");
	});

	it("emits nothing extra when no output arrives (no periodic heartbeat)", async () => {
		const notify = new Notify();
		let emits = 0;
		const stream = startRateLimitedStream({
			outputNotify: notify,
			emit: () => emits++,
			minIntervalMs: 5,
		});
		await new Promise((r) => setTimeout(r, 100)); // 100ms of silence
		assert.equal(emits, 1, "only the initial update — no timer-driven heartbeat");
		stream.stop();
		assert.equal(emits, 2);
	});

	it("emits again once the rate-limit interval has elapsed with new output", async () => {
		const notify = new Notify();
		let emits = 0;
		const stream = startRateLimitedStream({
			outputNotify: notify,
			emit: () => emits++,
			minIntervalMs: 20,
		});
		notify.notifyAll();
		await new Promise((r) => setTimeout(r, 60)); // trailing update fires
		assert.ok(emits >= 2, `expected a trailing rate-limited update; got ${emits}`);
		stream.stop();
	});
});
