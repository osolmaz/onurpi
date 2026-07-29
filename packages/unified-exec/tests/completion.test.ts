/**
 * Unit tests for the CompletionCoordinator (src/completion.ts) — the
 * exactly-once observation invariant, observation leases, suppression paths,
 * batching, and bounded wake-message content. All tests use fake sessions and
 * a fake send; no subprocesses, no long waits (debounce is 5 ms).
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
	buildWakeMessage,
	CompletionCoordinator,
	type CompletionSessionLike,
	type CompletionSnapshot,
	sanitizeMeta,
	type WakeMessage,
} from "../src/completion.ts";

class FakeSession implements CompletionSessionLike {
	readonly id: number;
	displayCommand = "sleep 99";
	cwd = "/tmp/project";
	startedAt = Date.now() - 1234;
	logPath: string | undefined = "/tmp/pi-unified-exec-fake.log";
	hasExited = false;
	exitCode: number | null = null;
	signal: string | null = null;
	failureMessage: string | null = null;
	private listeners = new Set<(s: unknown) => void>();

	constructor(id: number) {
		this.id = id;
	}

	onExit(listener: (s: unknown) => void): () => void {
		this.listeners.add(listener);
		if (this.hasExited) queueMicrotask(() => listener(this));
		return () => this.listeners.delete(listener);
	}

	exit(code: number): void {
		this.hasExited = true;
		this.exitCode = code;
		for (const l of this.listeners) l(this);
	}

	/** Simulate a duplicate exit callback. */
	fireExitAgain(): void {
		for (const l of this.listeners) l(this);
	}
}

function makeCoordinator(opts: { failSends?: number } = {}) {
	const sent: WakeMessage[] = [];
	const errors: unknown[] = [];
	let remainingFailures = opts.failSends ?? 0;
	const coordinator = new CompletionCoordinator({
		send: (m) => {
			if (remainingFailures > 0) {
				remainingFailures--;
				throw new Error("send failed");
			}
			sent.push(m);
		},
		debounceMs: 5,
		onSendError: (e) => errors.push(e),
	});
	return { coordinator, sent, errors };
}

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("CompletionCoordinator", () => {
	it("unregistered sessions (on_exit omitted/none) never wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		// never registered
		s.exit(0);
		coordinator.flushPending();
		await settle();
		assert.equal(sent.length, 0);
	});

	it("armed session exiting while idle sends exactly one wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
		assert.match(sent[0].content, /session_id=1/);
		assert.match(sent[0].content, /exit_code=0/);
		assert.equal(coordinator.recordCount, 0, "record resolved after send");
	});

	it("register handles the boundary race: session already exited when registered", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		s.exit(3); // exits before register (exec_command decided while it was alive)
		coordinator.register(s);
		await settle();
		assert.equal(sent.length, 1, "completion must not be lost");
		assert.match(sent[0].content, /exit_code=3/);
	});

	it("exit while an observer is active is held; successful finalization suppresses the wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.beginObservation(1, "call-1");
		s.exit(0);
		await settle();
		assert.equal(sent.length, 0, "exit held while observed");
		// Handler returned a terminal result; pi finalizes it successfully.
		coordinator.markPendingTerminal(1, "call-1");
		coordinator.handleToolExecutionEnd("call-1", false);
		await settle();
		assert.equal(sent.length, 0, "direct delivery consumed the wake");
		assert.equal(coordinator.recordCount, 0);
	});

	it("terminal result finalized as error keeps the completion wake-eligible", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.beginObservation(1, "call-1");
		s.exit(0);
		coordinator.markPendingTerminal(1, "call-1");
		coordinator.handleToolExecutionEnd("call-1", true); // error/cancelled finalization
		await settle();
		assert.equal(sent.length, 1, "wake must still fire");
	});

	it("observer released at deadline keeps the wake armed; later exit wakes once", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.beginObservation(1, "call-1");
		coordinator.releaseObservation(1, "call-1"); // deadline reached, still running
		await settle();
		assert.equal(sent.length, 0);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
	});

	it("cancelled observation (lease cleaned via tool_execution_end) keeps the wake armed", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.beginObservation(1, "call-1");
		// Handler was cancelled and never released; pi still emits tool_execution_end.
		coordinator.handleToolExecutionEnd("call-1", true);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
	});

	it("setOnExit none disarms an armed wake; natural exit does not notify", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		assert.equal(coordinator.setOnExit(1, "none", s), "disarmed");
		assert.equal(coordinator.isArmed(1), false);
		s.exit(1);
		await settle();
		assert.equal(sent.length, 0);
		assert.equal(coordinator.setOnExit(1, "none", s), "already_none");
	});

	it("setOnExit wake arms a previously unarmed running session", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(2);
		assert.equal(coordinator.setOnExit(2, "wake", s), "armed");
		assert.equal(coordinator.isArmed(2), true);
		assert.equal(coordinator.setOnExit(2, "wake", s), "already_armed");
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
	});

	it("setOnExit wake is too_late after the session has already exited unregistered", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(3);
		s.exit(0);
		assert.equal(coordinator.setOnExit(3, "wake", s), "too_late");
		await settle();
		assert.equal(sent.length, 0);
	});

	it("setOnExit none after exit but before flush suppresses the wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(4);
		coordinator.register(s);
		s.exit(7);
		// Debounce has not fired yet.
		assert.equal(coordinator.setOnExit(4, "none", s), "disarmed");
		await settle();
		assert.equal(sent.length, 0);
	});

	it("setOnExit none disarms a tombstone record without a store session", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(5);
		coordinator.register(s);
		s.exit(1);
		// Evict exited session: tombstone keeps the pending wake.
		coordinator.handleEviction(s);
		// Disarm by id only (no live session object) — the set_on_exit tool path.
		assert.equal(coordinator.setOnExit(5, "none", null), "disarmed");
		await settle();
		assert.equal(sent.length, 0);
	});

	it("explicit kill suppresses the wake before the exit lands", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.suppress(1); // kill_session / slash command, before signaling
		s.exit(143);
		coordinator.confirmKill(1);
		await settle();
		assert.equal(sent.length, 0);
		assert.equal(coordinator.recordCount, 0);
	});

	it("failed kill restores wake eligibility", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.suppress(1);
		// kill did NOT land; process still alive
		coordinator.restoreAfterFailedKill(1);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
	});

	it("shutdown cancels pending wakes and never injects stale prompts", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		coordinator.shutdown(); // before the debounce fires
		await settle();
		assert.equal(sent.length, 0);
		// After reset (new session_start), old records stay gone.
		coordinator.reset();
		coordinator.flushPending();
		await settle();
		assert.equal(sent.length, 0);
	});

	it("simultaneous completions batch into one bounded prompt", async () => {
		const { coordinator, sent } = makeCoordinator();
		const a = new FakeSession(1);
		const b = new FakeSession(2);
		const c = new FakeSession(3);
		coordinator.register(a);
		coordinator.register(b);
		coordinator.register(c);
		a.exit(0);
		b.exit(1);
		c.exit(0);
		await settle();
		assert.equal(sent.length, 1, "one prompt for the batch");
		assert.match(sent[0].content, /session_id=1/);
		assert.match(sent[0].content, /session_id=2/);
		assert.match(sent[0].content, /session_id=3/);
	});

	it("duplicate exit callbacks and repeated flushes never duplicate wakes", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		s.fireExitAgain();
		s.fireExitAgain();
		coordinator.flushPending();
		coordinator.flushPending();
		await settle();
		coordinator.flushPending();
		assert.equal(sent.length, 1);
	});

	it("after a wake is sent, later observations never cause another wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 1);
		// The model later drains the exited session's final output.
		coordinator.beginObservation(1, "call-2");
		coordinator.markPendingTerminal(1, "call-2");
		coordinator.handleToolExecutionEnd("call-2", false);
		await settle();
		assert.equal(sent.length, 1);
	});

	it("list_sessions observing the exit before notification suppresses the wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		coordinator.observeViaListing(1); // reaped by list_sessions before the debounce
		await settle();
		assert.equal(sent.length, 0);
	});

	it("eviction of a live process suppresses the wake", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		coordinator.handleEviction(s); // still alive → LRU terminates it
		s.exit(143); // induced exit
		await settle();
		assert.equal(sent.length, 0);
	});

	it("eviction of a naturally exited wake session keeps a tombstone and still wakes once", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0); // natural completion, not yet notified
		coordinator.handleEviction(s); // store drops the session
		await settle();
		assert.equal(sent.length, 1, "completion must not be silently lost");
		assert.match(sent[0].content, /log_path: \/tmp\/pi-unified-exec-fake\.log/);
	});

	it("a failed send is retried at the next flush trigger, still exactly once", async () => {
		const { coordinator, sent, errors } = makeCoordinator({ failSends: 1 });
		const s = new FakeSession(1);
		coordinator.register(s);
		s.exit(0);
		await settle();
		assert.equal(sent.length, 0);
		assert.equal(errors.length, 1);
		coordinator.flushPending(); // e.g. agent_settled
		await settle();
		assert.equal(sent.length, 1);
		coordinator.flushPending();
		assert.equal(sent.length, 1);
	});

	it("wake content is bounded metadata without raw output, with control chars stripped", async () => {
		const { coordinator, sent } = makeCoordinator();
		const s = new FakeSession(7);
		s.displayCommand = `echo \u001b[31mevil\u0007 && ${"x".repeat(500)}`;
		s.failureMessage = `bad\u001b]0;title\u0007thing ${"y".repeat(500)}`;
		coordinator.register(s);
		s.exit(2);
		await settle();
		assert.equal(sent.length, 1);
		const content = sent[0].content;
		assert.ok(!content.includes("\u001b"), "escape bytes stripped");
		assert.ok(!content.includes("\u0007"), "BEL stripped");
		assert.ok(content.length < 2000, `content should be bounded; got ${content.length}`);
		assert.match(content, /not user-authored instructions/);
		assert.match(content, /write_stdin/);
		assert.match(content, /continue the original task/);
	});
});

describe("buildWakeMessage", () => {
	it("caps the number of listed sessions", () => {
		const snapshots: CompletionSnapshot[] = Array.from({ length: 40 }, (_, i) => ({
			sessionId: i + 1,
			command: `job ${i + 1}`,
			cwd: "/tmp",
			startedAtMs: 0,
			elapsedMs: 1000,
			exitCode: 0,
			signal: null,
			failureMessage: null,
			logPath: `/tmp/log-${i + 1}.log`,
		}));
		const msg = buildWakeMessage(snapshots);
		assert.match(msg.content, /40 background sessions exited/);
		assert.match(msg.content, /and 24 more/);
		assert.ok(msg.details.sessions.length <= 16);
	});
});

describe("sanitizeMeta", () => {
	it("strips C0/C1 control characters but keeps plain text", () => {
		assert.equal(sanitizeMeta("a\u0000b\u001bc\u0007d\u009fe"), "abcde");
		assert.equal(sanitizeMeta("plain text"), "plain text");
	});
});
