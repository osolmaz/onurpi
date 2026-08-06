/**
 * collectOutputUntilDeadline — port of codex's `collect_output_until_deadline`.
 *
 * Drains an output buffer, waking on new-data notifications, until either:
 *   - the deadline passes, or
 *   - the process signals exit AND the output channel is closed, or
 *   - the abort signal fires.
 *
 * When the exit cancellation token fires before the deadline, we give a short
 * `postExitCloseWaitMs` grace (default 50ms) to pick up trailing output before
 * breaking.
 *
 * Design differences vs codex:
 *   - No `pause_state`: pi does not have codex's "out of band elicitation
 *     pause" concept, so the deadline is not extended across pauses.
 *   - Uses `AbortSignal` instead of tokio `CancellationToken`.
 */

import type { HeadTailBuffer } from "./head-tail-buffer.ts";
import type { Gate, Notify } from "./notify.ts";

const POST_EXIT_CLOSE_WAIT_MS = 50;

const markerEncoder = new TextEncoder();

/**
 * Marker spliced into the collected payload at the exact position where the
 * HeadTailBuffer dropped middle bytes, so the model never mistakes
 * head+tail as contiguous output. The full stream is always in the log file.
 */
function omissionMarker(omittedBytes: number, retentionBytes: number): Uint8Array {
	return markerEncoder.encode(
		`\n[... ${omittedBytes} bytes omitted here (output exceeded the ${retentionBytes}-byte in-memory retention between polls; the full stream is in the session log file) ...]\n`,
	);
}

export interface CollectInputs {
	/** Buffer to drain. Chunks removed from it are returned to the caller. */
	buffer: HeadTailBuffer;
	/** Fired when new data arrives in `buffer`. */
	outputNotify: Notify;
	/** Closed when the underlying stream ends (process exit + streams drained). */
	outputClosed: Gate;
	/** Fired as soon as the process has exited (may or may not have trailing output). */
	exited: AbortSignal;
	/** Absolute monotonic deadline (Date.now() ms) to stop waiting. */
	deadlineMs: number;
	/** External abort (e.g. user pressed Esc). Breaks out immediately. */
	externalAbort?: AbortSignal;
	/** Override the trailing-output grace after exit (ms). */
	postExitCloseWaitMs?: number;
}

/** Collected payload plus how many middle bytes the retention cap dropped. */
export interface CollectResult {
	/** Concatenated bytes, with an omission marker spliced in when bytes were dropped. */
	bytes: Uint8Array;
	/** Total middle bytes dropped by the HeadTailBuffer across this call's drains. */
	omittedBytes: number;
}

/**
 * Collect all currently-buffered bytes, then keep waiting for more until the
 * deadline or a break condition. Returns the concatenated byte payload plus
 * the omitted-middle-byte count (marker spliced at each omission point).
 *
 * The buffer is drained non-destructively to the process output pipe — new
 * output arriving after we return stays in the buffer for the next collect().
 */
export async function collectOutputUntilDeadline(inputs: CollectInputs): Promise<CollectResult> {
	const { buffer, outputNotify, outputClosed, exited, deadlineMs, externalAbort } = inputs;
	const postExitCloseWaitCap = inputs.postExitCloseWaitMs ?? POST_EXIT_CLOSE_WAIT_MS;

	const collected: Uint8Array[] = [];
	let omittedTotal = 0;
	let exitSignalReceived = exited.aborted;
	let postExitDeadline: number | undefined;

	// The deadline and both abort signals are fixed for the lifetime of this
	// call, so their promises are created ONCE and reused in every race below.
	// Creating them per loop iteration would leak one abort listener and one
	// timer per output chunk: chatty processes inside a long poll trip Node's
	// EventTarget max-listener warning and accumulate thousands of live timers.
	// All listeners/timers are released in the `finally` block.
	const cleanups: Array<() => void> = [];
	try {
		const exitedP = abortPromise(exited, cleanups).then(() => "exit" as const);
		// Per-call (NOT module-global) so the reactions Promise.race attaches to a
		// never-settling promise become collectable once this call returns.
		const externalP: Promise<"external"> = externalAbort
			? abortPromise(externalAbort, cleanups).then(() => "external" as const)
			: new Promise<never>(() => {});
		const deadlineP = timeoutPromise(deadlineMs - Date.now(), cleanups).then(() => "timeout" as const);
		let closedP: Promise<"closed"> | undefined;
		let graceP: Promise<"timeout"> | undefined;

		for (;;) {
			if (externalAbort?.aborted) break;

			// 1) Drain whatever is currently buffered.
			const drained = buffer.drainSegments();
			const drainedCount = drained.head.length + drained.tail.length;

			if (drainedCount === 0 && drained.omittedBytes === 0) {
				if (exited.aborted) exitSignalReceived = true;
				if (exitSignalReceived && outputClosed.isClosed) break;

				const now = Date.now();
				if (now >= deadlineMs) break;

				if (exitSignalReceived) {
					// Process exited but stream not closed yet — give it a short grace.
					if (postExitDeadline === undefined) {
						postExitDeadline = now + Math.min(deadlineMs - now, postExitCloseWaitCap);
						graceP = timeoutPromise(postExitDeadline - now, cleanups).then(() => "timeout" as const);
					}
					if (Date.now() >= postExitDeadline) break;
					closedP ??= outputClosed.closed().then(() => "closed" as const);
					const which = await Promise.race([
						outputNotify.notified().then(() => "output" as const),
						closedP,
						graceP!,
						externalP,
					]);
					if (which === "timeout" || which === "external") break;
					continue;
				}

				// Still running — wait for next event.
				const which = await Promise.race([
					outputNotify.notified().then(() => "output" as const),
					exitedP,
					deadlineP,
					externalP,
				]);
				if (which === "timeout" || which === "external") break;
				if (which === "exit") exitSignalReceived = true;
				continue;
			}

			// 2) Collected some bytes — keep them (marker spliced at the exact
			// head/tail boundary when the retention cap dropped middle bytes).
			for (const chunk of drained.head) collected.push(chunk);
			if (drained.omittedBytes > 0) {
				omittedTotal += drained.omittedBytes;
				collected.push(omissionMarker(drained.omittedBytes, buffer.maxBytes));
			}
			for (const chunk of drained.tail) collected.push(chunk);

			if (exited.aborted) exitSignalReceived = true;
			if (Date.now() >= deadlineMs) break;
		}
	} finally {
		for (const cleanup of cleanups) cleanup();
	}

	return { bytes: concat(collected), omittedBytes: omittedTotal };
}

/**
 * A promise that resolves when the signal aborts. The registered listener is
 * removed via `cleanups` if the signal never fires.
 */
function abortPromise(signal: AbortSignal, cleanups: Array<() => void>): Promise<void> {
	if (signal.aborted) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const onAbort = () => resolve();
		signal.addEventListener("abort", onAbort, { once: true });
		cleanups.push(() => signal.removeEventListener("abort", onAbort));
	});
}

/** A cancellable timeout promise; the timer is cleared via `cleanups`. */
function timeoutPromise(ms: number, cleanups: Array<() => void>): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms);
		cleanups.push(() => clearTimeout(timer));
	});
}

function concat(chunks: Uint8Array[]): Uint8Array {
	let total = 0;
	for (const c of chunks) total += c.length;
	const out = new Uint8Array(total);
	let offset = 0;
	for (const c of chunks) {
		out.set(c, offset);
		offset += c.length;
	}
	return out;
}
