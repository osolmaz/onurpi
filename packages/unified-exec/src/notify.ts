/**
 * A one-shot-per-wait async gate, equivalent to Tokio's `Notify`.
 *
 * Semantics (same as codex's `output_notify`):
 * - `notified()` returns a Promise that resolves the next time `notifyAll()`
 *   is called. Calls to `notifyAll()` that happen BEFORE `notified()` is
 *   awaited are NOT stored (no backlog) — the waiter only sees the next one.
 * - Multiple concurrent waiters are all woken by a single `notifyAll()`.
 *
 * This matches Tokio's `Notify::notified()` / `Notify::notify_waiters()` usage
 * in `collect_output_until_deadline`: pending waiters are released in a batch
 * when output arrives, and a notification without a waiter is lost.
 */
export class Notify {
	private waiters: Array<() => void> = [];

	/** Returns a Promise that resolves on the next `notifyAll()` call. */
	notified(): Promise<void> {
		return new Promise<void>((resolve) => {
			this.waiters.push(resolve);
		});
	}

	/** Wake every waiter that was created before this call. */
	notifyAll(): void {
		if (this.waiters.length === 0) return;
		const toWake = this.waiters;
		this.waiters = [];
		for (const resolve of toWake) resolve();
	}

	/** Number of waiters currently parked (test helper). */
	get waiterCount(): number {
		return this.waiters.length;
	}
}

/**
 * A sticky boolean gate. Once closed, `await closed()` resolves immediately
 * forever after. Analogous to codex's `output_closed: AtomicBool` + the
 * `output_closed_notify` combo, collapsed into one primitive.
 */
export class Gate {
	private state = false;
	private waiters: Array<() => void> = [];

	/** Returns true after `close()` has been called at least once. */
	get isClosed(): boolean {
		return this.state;
	}

	/** Close the gate and release all waiters. Idempotent. */
	close(): void {
		if (this.state) return;
		this.state = true;
		const toWake = this.waiters;
		this.waiters = [];
		for (const resolve of toWake) resolve();
	}

	/** Resolves as soon as the gate is (or becomes) closed. */
	closed(): Promise<void> {
		if (this.state) return Promise.resolve();
		return new Promise<void>((resolve) => {
			this.waiters.push(resolve);
		});
	}
}

/** Sleep for `ms` milliseconds, optionally aborted by `signal`. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise<void>((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			resolve();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
