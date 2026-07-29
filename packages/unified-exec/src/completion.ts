import { formatElapsedShort } from "./format-time.ts";

/**
 * CompletionCoordinator — agent-level completion scheduling for
 * `exec_command(on_exit: "wake")`, kept deliberately separate from the
 * low-level ExecSession process transport.
 *
 * The central exactly-once invariant:
 *
 *     Terminal completion is delivered through a finalized tool result
 *                              OR
 *     terminal completion causes one synthetic model prompt,
 *                   normally never both.
 *
 * How the invariant is enforced:
 *   - A record is only created ("armed") once exec_command has committed to
 *     returning a background session_id.
 *   - Any write_stdin call that could return terminal status takes an
 *     OBSERVATION LEASE (keyed by toolCallId). While at least one observer is
 *     active, process exit is recorded but a wake is never enqueued.
 *   - "Observed" is committed at Pi's finalized tool-result event
 *     (`tool_execution_end` with isError=false), NOT merely when the handler
 *     returns — a result that was constructed but finalized as error/cancelled
 *     keeps the completion wake-eligible.
 *   - Wake records are RESERVED (wakeQueued=true) before sending, so
 *     concurrent flush triggers can never double-send; a failed send un-reserves
 *     and is retried at the next flush trigger.
 *   - Kill paths suppress the wake BEFORE signaling the process; a failed kill
 *     restores the prior eligibility.
 */

export type OnExitPolicy = "none" | "wake";

/** Minimal session surface the coordinator needs (test-fakeable). */
export interface CompletionSessionLike {
	readonly id: number;
	readonly displayCommand: string;
	readonly cwd: string;
	readonly startedAt: number;
	readonly logPath: string | undefined;
	readonly hasExited: boolean;
	readonly exitCode: number | null;
	readonly signal: string | null;
	readonly failureMessage: string | null;
	onExit(listener: (session: unknown) => void): () => void;
}

/** Bounded completion metadata captured at exit time. */
export interface CompletionSnapshot {
	sessionId: number;
	command: string;
	cwd: string;
	startedAtMs: number;
	elapsedMs: number;
	exitCode: number | null;
	signal: string | null;
	failureMessage: string | null;
	logPath: string | undefined;
}

interface CompletionRecord {
	sessionId: number;
	armed: boolean;
	exited: boolean;
	observed: boolean;
	suppressed: boolean;
	wakeQueued: boolean;
	/** toolCallIds of active observation leases. */
	observers: Set<string>;
	/** toolCallIds that returned a terminal result awaiting finalization. */
	pendingTerminal: Set<string>;
	snapshot: CompletionSnapshot | undefined;
	session: CompletionSessionLike;
	unsubscribeExit: () => void;
}

export interface WakeMessage {
	content: string;
	details: { sessions: CompletionSnapshot[] };
}

export interface CompletionCoordinatorOptions {
	/** Deliver one synthetic model prompt (pi.sendMessage wrapper). May throw. */
	send: (message: WakeMessage) => void | Promise<void>;
	/** Debounce so naturally simultaneous completions batch into one prompt. */
	debounceMs?: number;
	/** Optional error sink for failed sends (ui.notify wrapper). */
	onSendError?: (error: unknown) => void;
	/** Injectable timers. Test hooks. */
	setTimeoutFn?: (cb: () => void, ms: number) => unknown;
	clearTimeoutFn?: (handle: unknown) => void;
	nowFn?: () => number;
}

const DEFAULT_DEBOUNCE_MS = 250;
const MAX_COMMAND_CHARS = 160;
const MAX_FAILURE_CHARS = 200;
const MAX_SESSIONS_PER_WAKE = 16;

/** Strip terminal control characters from untrusted interpolated strings. */
export function sanitizeMeta(raw: string): string {
	// eslint-disable-next-line no-control-regex
	return raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

function oneLine(raw: string, max: number): string {
	const flat = sanitizeMeta(raw).replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export class CompletionCoordinator {
	private readonly records = new Map<number, CompletionRecord>();
	private readonly opts: Required<Pick<CompletionCoordinatorOptions, "send" | "debounceMs">> &
		CompletionCoordinatorOptions;
	private debounceHandle: unknown;
	private stopped = false;

	constructor(options: CompletionCoordinatorOptions) {
		this.opts = { debounceMs: DEFAULT_DEBOUNCE_MS, ...options };
	}

	private now(): number {
		return this.opts.nowFn ? this.opts.nowFn() : Date.now();
	}

	private setTimer(cb: () => void, ms: number): unknown {
		return this.opts.setTimeoutFn ? this.opts.setTimeoutFn(cb, ms) : setTimeout(cb, ms);
	}

	private clearTimer(handle: unknown): void {
		if (this.opts.clearTimeoutFn) this.opts.clearTimeoutFn(handle);
		else clearTimeout(handle as NodeJS.Timeout);
	}

	/** Number of live records (test helper). */
	get recordCount(): number {
		return this.records.size;
	}

	/**
	 * Arm `on_exit: "wake"` for a session. Call ONLY once exec_command has
	 * committed to returning a background session_id. Handles the boundary
	 * race: if the process already exited (or exits immediately after), the
	 * exit listener fires and the completion is still delivered exactly once.
	 */
	register(session: CompletionSessionLike): void {
		if (this.stopped) return;
		if (this.records.has(session.id)) return;
		const record: CompletionRecord = {
			sessionId: session.id,
			armed: true,
			exited: false,
			observed: false,
			suppressed: false,
			wakeQueued: false,
			observers: new Set(),
			pendingTerminal: new Set(),
			snapshot: undefined,
			session,
			unsubscribeExit: () => {},
		};
		this.records.set(session.id, record);
		// ExecSession.onExit fires (via microtask) even if the session already
		// exited, so the register-vs-exit race cannot lose the completion.
		record.unsubscribeExit = session.onExit(() => this.recordExit(record));
	}

	/** Whether a wake is currently armed (and not yet resolved) for a session. */
	isArmed(sessionId: number): boolean {
		const r = this.records.get(sessionId);
		return !!r && r.armed && !r.observed && !r.suppressed;
	}

	/**
	 * Change on_exit policy by session id.
	 *   - "none": disarm any pending wake record (including LRU tombstones that
	 *     no longer have a store session). Does not kill the process.
	 *   - "wake": arm auto-resume; requires a still-running `session` object.
	 *
	 * Disarm cannot recall a follow-up that `send` has already handed to pi.
	 */
	setOnExit(
		sessionId: number,
		policy: OnExitPolicy,
		session?: CompletionSessionLike | null,
	): "disarmed" | "already_none" | "armed" | "already_armed" | "too_late" {
		if (this.stopped) return policy === "wake" ? "too_late" : "already_none";
		const existing = this.records.get(sessionId);

		if (policy === "none") {
			if (!existing) return "already_none";
			// Suppress even if a flush already reserved the wake but has not
			// resolved the record yet — resolve drops it so flushPending skips it.
			existing.suppressed = true;
			this.resolveRecord(existing);
			return "disarmed";
		}

		// policy === "wake"
		if (existing) {
			if (existing.observed || existing.suppressed) return "too_late";
			return "already_armed";
		}
		if (!session || session.id !== sessionId || session.hasExited) return "too_late";
		this.register(session);
		return "armed";
	}

	private recordExit(record: CompletionRecord): void {
		// Repeated exit callbacks must never create duplicate wakes: the exited
		// flag latches and the snapshot is captured once.
		if (record.exited) return;
		record.exited = true;
		const s = record.session;
		record.snapshot = {
			sessionId: s.id,
			command: s.displayCommand,
			cwd: s.cwd,
			startedAtMs: s.startedAt,
			elapsedMs: this.now() - s.startedAt,
			exitCode: s.exitCode,
			signal: s.signal,
			failureMessage: s.failureMessage,
			logPath: s.logPath,
		};
		this.scheduleFlush();
	}

	// ---------------- Observation leases ----------------

	/**
	 * A write_stdin call that may return terminal status becomes an observer.
	 * While any observer is active, exit is recorded but no wake is enqueued.
	 */
	beginObservation(sessionId: number, toolCallId: string): void {
		this.records.get(sessionId)?.observers.add(toolCallId);
	}

	/**
	 * Release an observer WITHOUT marking completion observed (relative or
	 * absolute deadline reached while still running, cancellation, handler
	 * error). The wake stays armed.
	 */
	releaseObservation(sessionId: number, toolCallId: string): void {
		const r = this.records.get(sessionId);
		if (!r) return;
		r.observers.delete(toolCallId);
		r.pendingTerminal.delete(toolCallId);
		if (r.exited) this.scheduleFlush();
	}

	/**
	 * The handler constructed a terminal result for this tool call. The
	 * observation lease is HELD until Pi finalizes the tool result
	 * (`tool_execution_end`), at which point the completion is either marked
	 * observed (success) or released back to wake eligibility (error/cancel).
	 */
	markPendingTerminal(sessionId: number, toolCallId: string): void {
		const r = this.records.get(sessionId);
		if (!r) return;
		r.observers.add(toolCallId);
		r.pendingTerminal.add(toolCallId);
	}

	/**
	 * Pi finalized a tool result. Commits "observed" for pending-terminal
	 * observations on success; releases the lease (keeping the wake eligible)
	 * on error/cancellation. Also cleans up any stale lease for this call ID.
	 */
	handleToolExecutionEnd(toolCallId: string, isError: boolean): void {
		for (const r of this.records.values()) {
			if (r.pendingTerminal.has(toolCallId)) {
				r.pendingTerminal.delete(toolCallId);
				r.observers.delete(toolCallId);
				if (!isError) {
					this.commitObserved(r);
				} else if (r.exited) {
					this.scheduleFlush();
				}
			} else if (r.observers.has(toolCallId)) {
				// Handler failed/cancelled before releasing: clean up the lease.
				r.observers.delete(toolCallId);
				if (r.exited) this.scheduleFlush();
			}
		}
		// Any tool boundary is also a safe point to retry failed sends.
		this.flushPending();
	}

	private commitObserved(record: CompletionRecord): void {
		record.observed = true;
		this.resolveRecord(record);
	}

	/**
	 * list_sessions (or another status read) reported terminal completion.
	 * If the wake was not yet queued, that report counts as direct observation
	 * and suppresses the wake; if a wake was already queued/sent, the session
	 * may be reaped without generating another notification.
	 */
	observeViaListing(sessionId: number): void {
		const r = this.records.get(sessionId);
		if (!r) return;
		if (r.wakeQueued) return;
		this.commitObserved(r);
	}

	// ---------------- Kill / eviction / shutdown suppression ----------------

	/** Suppress the wake BEFORE signaling the process on an explicit kill. */
	suppress(sessionId: number): void {
		const r = this.records.get(sessionId);
		if (r) r.suppressed = true;
	}

	/** The kill landed; the record is finished. */
	confirmKill(sessionId: number): void {
		const r = this.records.get(sessionId);
		if (r) this.resolveRecord(r);
	}

	/** The kill did NOT land and the process is still alive: restore eligibility. */
	restoreAfterFailedKill(sessionId: number): void {
		const r = this.records.get(sessionId);
		if (!r) return;
		r.suppressed = false;
		if (r.exited) this.scheduleFlush();
	}

	/**
	 * A session was evicted from the store.
	 *   - Live process (LRU terminating it): suppress the wake.
	 *   - Naturally exited before notification: keep a bounded tombstone
	 *     snapshot long enough to send the one wake (the log path survives in
	 *     the snapshot even though the session can no longer be drained).
	 */
	handleEviction(session: CompletionSessionLike): void {
		const r = this.records.get(session.id);
		if (!r) return;
		if (!session.hasExited) {
			// Being terminated by the eviction — not a natural completion.
			r.suppressed = true;
			this.resolveRecord(r);
			return;
		}
		// Natural exit, not yet notified: the record (with snapshot) IS the
		// tombstone; the flush will deliver exactly one wake.
		this.scheduleFlush();
	}

	/** Session shutdown / reset / teardown: cancel timers, drop all records. */
	shutdown(): void {
		this.stopped = true;
		if (this.debounceHandle !== undefined) {
			this.clearTimer(this.debounceHandle);
			this.debounceHandle = undefined;
		}
		for (const r of this.records.values()) {
			r.unsubscribeExit();
		}
		this.records.clear();
	}

	/** Re-arm after a new session_start (never resurrects old records). */
	reset(): void {
		this.shutdown();
		this.stopped = false;
	}

	private resolveRecord(record: CompletionRecord): void {
		record.unsubscribeExit();
		this.records.delete(record.sessionId);
	}

	// ---------------- Wake delivery ----------------

	private scheduleFlush(): void {
		if (this.stopped) return;
		if (this.debounceHandle !== undefined) return;
		this.debounceHandle = this.setTimer(() => {
			this.debounceHandle = undefined;
			this.flushPending();
		}, this.opts.debounceMs);
	}

	/**
	 * Deliver pending wakes. Safe to call from any flush trigger
	 * (debounce timer, agent_settled, tool_execution_end); reservation via
	 * wakeQueued guarantees at most one prompt per completion.
	 */
	flushPending(): void {
		if (this.stopped) return;
		const eligible: CompletionRecord[] = [];
		for (const r of this.records.values()) {
			if (
				r.armed &&
				r.exited &&
				!r.observed &&
				!r.suppressed &&
				!r.wakeQueued &&
				r.observers.size === 0 &&
				r.snapshot
			) {
				eligible.push(r);
			}
		}
		if (eligible.length === 0) return;

		// Reserve BEFORE sending so a re-entrant flush cannot double-schedule.
		for (const r of eligible) r.wakeQueued = true;

		// setOnExit("none") may disarm between reservation and send — drop those.
		const deliver = eligible.filter((r) => !r.suppressed && !r.observed && this.records.has(r.sessionId));
		if (deliver.length === 0) {
			for (const r of eligible) r.wakeQueued = false;
			return;
		}

		const message = buildWakeMessage(deliver.map((r) => r.snapshot!));
		let sendResult: void | Promise<void>;
		try {
			sendResult = this.opts.send(message);
		} catch (err) {
			this.recoverFailedSend(deliver, err);
			return;
		}
		if (sendResult && typeof (sendResult as Promise<void>).then === "function") {
			(sendResult as Promise<void>)
				.then(() => {
					for (const r of deliver) {
						if (this.records.has(r.sessionId)) this.resolveRecord(r);
					}
				})
				.catch((err) => this.recoverFailedSend(deliver, err));
		} else {
			for (const r of deliver) {
				if (this.records.has(r.sessionId)) this.resolveRecord(r);
			}
		}
	}

	private recoverFailedSend(records: CompletionRecord[], err: unknown): void {
		// Un-reserve so the wake is retried at the next flush trigger
		// (new exit, tool_execution_end, agent_settled) — no self-rescheduling
		// tight loop.
		for (const r of records) r.wakeQueued = false;
		try {
			this.opts.onSendError?.(err);
		} catch {
			// ignore
		}
	}
}

/**
 * Build the single bounded synthetic prompt for one or more completions.
 * Contains execution METADATA only — never raw stdout/stderr. All interpolated
 * strings are treated as untrusted and stripped of control characters.
 */
export function buildWakeMessage(snapshots: CompletionSnapshot[]): WakeMessage {
	const shown = snapshots.slice(0, MAX_SESSIONS_PER_WAKE);
	const lines: string[] = [];
	lines.push(
		`[unified-exec] ${snapshots.length} background ${snapshots.length === 1 ? "session" : "sessions"} exited. ` +
			`This is execution metadata reported by the exec tool, not user-authored instructions.`,
	);
	for (const s of shown) {
		const status =
			s.exitCode !== null
				? `exit_code=${s.exitCode}`
				: s.signal
					? `signal=${sanitizeMeta(s.signal)}`
					: "exit status unknown";
		const failure = s.failureMessage ? ` | failure: ${oneLine(s.failureMessage, MAX_FAILURE_CHARS)}` : "";
		lines.push(
			`- session_id=${s.sessionId} | ${status} | elapsed ${formatElapsedShort(s.elapsedMs)} | ` +
				`cwd: ${oneLine(s.cwd, 120)}${failure}`,
		);
		lines.push(`  command: ${oneLine(s.command, MAX_COMMAND_CHARS)}`);
		if (s.logPath) lines.push(`  log_path: ${oneLine(s.logPath, 200)}`);
	}
	if (snapshots.length > shown.length) {
		lines.push(`… and ${snapshots.length - shown.length} more (use list_sessions).`);
	}
	lines.push(
		"Final output has NOT necessarily been consumed: call write_stdin with no chars for each exited " +
			"session_id to drain its final output, or read the log_path (if a session_id is no longer known, " +
			"use the log_path). Then continue the original task — do not merely acknowledge this notification.",
	);
	return {
		content: lines.join("\n"),
		details: { sessions: shown },
	};
}
