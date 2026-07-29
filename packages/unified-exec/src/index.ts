/**
 * unified-exec — pi extension that ports codex's unified_exec session model,
 * with pi's built-in `bash` tool's on-disk retention layered on top.
 *
 * Tools exposed to the LLM:
 *   - exec_command(cmd, workdir?, shell?, tty?, yield_time_ms?, on_exit?)
 *   - write_stdin(session_id, chars?, yield_time_ms?, yield_until?)
 *   - set_on_exit(session_id, on_exit)            [disarm/re-arm wake without kill]
 *   - kill_session(session_id, signal?)          [pi-flavor; codex has no equivalent]
 *   - list_sessions()                            [pi-flavor]
 *
 * Semantics:
 *   - Every exec_command starts a long-lived session. If the process is still
 *     alive when the call's yield deadline expires, the tool returns with
 *     `session_id` in its body and the LLM can follow up with write_stdin.
 *   - `write_stdin` with empty `chars` is a pure poll; with non-empty, it also
 *     writes the bytes (including \\x03 for Ctrl-C, \\x04 for EOF).
 *   - Aborting the tool call (Esc) breaks the wait but does not kill the
 *     session; the next turn can still drive it.
 *   - Sessions are terminated on session_shutdown (codex parity).
 *   - Every byte the child writes goes to a per-session log file at
 *     /tmp/pi-unified-exec-<sid>-<random>.log. The LLM sees the last ~50 KiB
 *     / 2000 lines per call and the full file is available via `read`.
 */

import { randomBytes } from "node:crypto";
import { constants as osConstants } from "node:os";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type ExtensionAPI,
	type ExtensionContext,
	formatSize,
	truncateTail,
	type TruncationResult,
} from "@earendil-works/pi-coding-agent";
import { Type, type TUnsafe } from "typebox";

import { collectOutputUntilDeadline } from "./collect.ts";
import { CompletionCoordinator, type OnExitPolicy } from "./completion.ts";
import { type LongWaitOutcome, startRateLimitedStream, waitForExitOrDeadline } from "./long-wait.ts";
import { formatElapsed } from "./format-time.ts";
import { nowUtcIso, parseYieldUntil } from "./time.ts";
import { sleep } from "./notify.ts";
import { isPtyAvailable, getPtyLoadError } from "./pty.ts";
import { renderExecCommandCall, renderResult, renderSetOnExitCall, renderWriteStdinCall } from "./render.ts";
import { ExecSession } from "./session.ts";
import { SessionStore } from "./session-store.ts";
import { buildShellCommand, IS_WINDOWS, resolveDefaultShell, resolveWindowsShell } from "./shell.ts";
import { unescapeChars } from "./unescape.ts";

// ---------------- Constants (mirror codex) ----------------

const MIN_YIELD_TIME_MS = 250;
const MAX_YIELD_TIME_MS = 30_000;
const MIN_EMPTY_YIELD_TIME_MS = 5_000;
// Diverges from codex (30 min): kept below Anthropic's 5-minute prompt-cache
// TTL so a long empty poll never outlives the cached prompt prefix. This is a
// HARD cache-friendly ceiling: the env override below may lower it but never
// raise the relative cap above 290 s — longer waits must use `yield_until`.
const DEFAULT_MAX_BACKGROUND_POLL_MS = 290_000;
export const MAX_EMPTY_POLL_ENV_VAR = "PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS";
const DEFAULT_EXEC_YIELD_MS = 10_000;
const DEFAULT_WRITE_STDIN_YIELD_MS = 250;
const EARLY_EXIT_GRACE_PERIOD_MS = 150;
const MAX_SESSIONS = 64;
const WARNING_SESSIONS = 60;
const LRU_PROTECTED_COUNT = 8;
const OUTPUT_POLL_INTERVAL_MS = 250; // onUpdate cadence (relative waits only)
// Absolute (`yield_until`) waits must not run the 250 ms heartbeat for hours;
// output-driven TUI updates are rate-limited to this interval instead.
const LONG_WAIT_UPDATE_INTERVAL_MS = 30_000;
const SESSION_UI_KEY = "unified-exec.sessions";

/**
 * Google-compatible string enum schema (plain `type: "string"` + `enum`,
 * mirroring pi-ai's StringEnum helper) — a TypeBox literal union (anyOf/const)
 * breaks Google models.
 */
function StringEnum<T extends readonly string[]>(values: T, description: string): TUnsafe<T[number]> {
	return Type.Unsafe<T[number]>({ type: "string", enum: values as unknown as string[], description });
}

// ---------------- Helpers ----------------

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

function clampYield(ms: number | undefined, defaultMs: number): number {
	const v = typeof ms === "number" && ms > 0 ? ms : defaultMs;
	return clamp(Math.floor(v), MIN_YIELD_TIME_MS, MAX_YIELD_TIME_MS);
}

export function resolveMaxEmptyPollMs(env: NodeJS.ProcessEnv = process.env): number {
	const raw = env[MAX_EMPTY_POLL_ENV_VAR]?.trim();
	if (!raw) return DEFAULT_MAX_BACKGROUND_POLL_MS;

	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_BACKGROUND_POLL_MS;
	// The env var may LOWER the cap, but the effective cache-friendly maximum
	// never exceeds 290 s — waits beyond that must use `yield_until`.
	return clamp(Math.floor(parsed), MIN_EMPTY_YIELD_TIME_MS, DEFAULT_MAX_BACKGROUND_POLL_MS);
}

/**
 * Resolve the yield for an empty poll. Oversized values are REJECTED with an
 * actionable error (including the host UTC time so the model can compute a
 * `yield_until` deadline) instead of being silently clamped; undersized values
 * keep the historical clamp-up-to-minimum behavior.
 */
function resolveEmptyPollYield(ms: number | undefined): number {
	const cap = resolveMaxEmptyPollMs();
	if (typeof ms === "number" && Math.floor(ms) > cap) {
		throw new Error(
			`write_stdin: yield_time_ms ${Math.floor(ms)} exceeds the empty-poll cap of ${cap} ms. ` +
				`Waits longer than 290 seconds require \`yield_until\`: omit yield_time_ms and pass an absolute ` +
				`UTC deadline such as "2026-07-21T18:30:00Z" (compute it from the current host time below). ` +
				`tool_time_utc: ${nowUtcIso()}`,
		);
	}
	const v = typeof ms === "number" && ms > 0 ? ms : DEFAULT_WRITE_STDIN_YIELD_MS;
	return clamp(Math.floor(v), MIN_EMPTY_YIELD_TIME_MS, cap);
}

/**
 * Normalize a user/LLM-supplied signal name ("TERM", "sigint", "SIGKILL") to
 * a valid NodeJS.Signals for the current platform. Throws on unknown names so
 * a typo doesn't silently no-op and then escalate to SIGKILL.
 */
function normalizeSignal(raw: string | undefined): NodeJS.Signals {
	if (!raw) return "SIGTERM";
	let name = raw.trim().toUpperCase();
	if (!name.startsWith("SIG")) name = `SIG${name}`;
	if (!(name in osConstants.signals)) {
		throw new Error(`unknown signal "${raw}" (use SIGTERM, SIGINT, SIGKILL, …)`);
	}
	return name as NodeJS.Signals;
}

function generateChunkId(): string {
	return randomBytes(3).toString("hex");
}

function approxTokenCount(bytes: Uint8Array): number {
	// Mirror codex's rough `approx_token_count` behaviour: 4 bytes ≈ 1 token.
	return Math.ceil(bytes.length / 4);
}

const textDecoder = new TextDecoder("utf-8", { fatal: false });
const textEncoder = new TextEncoder();

function decode(bytes: Uint8Array): string {
	return textDecoder.decode(bytes);
}

function encode(str: string): Uint8Array {
	return textEncoder.encode(str);
}

/**
 * Format the pi-bash style "[Showing lines X-Y of Z. Full output: <path>]" footer
 * that appears below truncated output.
 */
function truncationMarker(t: TruncationResult, logPath: string | undefined): string | null {
	if (!t.truncated) return null;
	const full = logPath ? `. Full output: ${logPath}` : "";
	if (t.lastLinePartial) {
		return `[Showing last ${formatSize(t.outputBytes)} of final line (line ${t.totalLines} is larger than the ${formatSize(DEFAULT_MAX_BYTES)} limit)${full}]`;
	}
	const startLine = t.totalLines - t.outputLines + 1;
	const endLine = t.totalLines;
	if (t.truncatedBy === "lines") {
		return `[Showing lines ${startLine}-${endLine} of ${t.totalLines}${full}]`;
	}
	return `[Showing lines ${startLine}-${endLine} of ${t.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)${full}]`;
}

/** Human-friendly rendering of the tool response. */
interface ResponseShape {
	chunk_id: string;
	wall_time_seconds: number;
	output: string;
	original_token_count?: number;
	session_id?: number;
	exit_code?: number;
	signal?: string;
	failure_message?: string;
	tty?: boolean;
	log_path?: string;
	cwd?: string;
	command?: string;
	yield_time_ms?: number;
	truncation?: TruncationResult;
	// Long-wait / completion-notification metadata:
	wait_mode?: "relative" | "absolute";
	wait_status?: "completed" | "relative_deadline_reached" | "absolute_deadline_reached" | "cancelled";
	yield_until?: string;
	effective_wait_ms?: number;
	on_exit?: OnExitPolicy;
	completion_notification?: "armed";
	completion_delivery?: "direct";
	on_exit_wake?: "consumed";
	tool_time_utc?: string;
}

function renderResponseText(shape: ResponseShape): string {
	const lines: string[] = [];
	const prefix = shape.session_id !== undefined ? "still running" : "exited";
	lines.push(`[${prefix}]`);
	if (shape.session_id !== undefined) lines.push(`session_id: ${shape.session_id}`);
	if (shape.exit_code !== undefined) lines.push(`exit_code: ${shape.exit_code}`);
	if (shape.signal) lines.push(`signal: ${shape.signal}`);
	if (shape.failure_message) lines.push(`failure: ${shape.failure_message}`);
	if (shape.wait_mode) lines.push(`wait_mode: ${shape.wait_mode}`);
	if (shape.wait_status) lines.push(`wait_status: ${shape.wait_status}`);
	if (shape.yield_until) lines.push(`yield_until: ${shape.yield_until}`);
	if (shape.effective_wait_ms !== undefined) lines.push(`effective_wait_ms: ${shape.effective_wait_ms}`);
	if (shape.on_exit) lines.push(`on_exit: ${shape.on_exit}`);
	if (shape.completion_notification) lines.push(`completion_notification: ${shape.completion_notification}`);
	if (shape.completion_delivery) lines.push(`completion_delivery: ${shape.completion_delivery}`);
	if (shape.on_exit_wake) lines.push(`on_exit_wake: ${shape.on_exit_wake}`);
	if (shape.tool_time_utc) lines.push(`tool_time_utc: ${shape.tool_time_utc}`);
	if (shape.log_path) lines.push(`log_path: ${shape.log_path}`);
	if (shape.cwd) lines.push(`cwd: ${shape.cwd}`);
	lines.push(`wall_time_seconds: ${shape.wall_time_seconds.toFixed(3)}`);
	lines.push(`chunk_id: ${shape.chunk_id}`);
	if (shape.original_token_count !== undefined) lines.push(`original_token_count: ${shape.original_token_count}`);
	if (shape.tty !== undefined) lines.push(`tty: ${shape.tty}`);
	const header = lines.join("\n");
	const body = shape.output || "(no output)";
	const marker = shape.truncation ? truncationMarker(shape.truncation, shape.log_path) : null;
	const footer = marker ? `\n\n${marker}` : "";
	return `${header}\n---\n${body}${footer}`;
}

// ---------------- Extension ----------------

interface ExtensionCtx {
	store: SessionStore;
	/** Agent-level wake scheduling for on_exit: "wake" (see completion.ts). */
	coordinator: CompletionCoordinator;
	ui: ExtensionContext["ui"] | undefined;
	widgetVisible: boolean;
	exitUnsubscribers: Map<number, () => void>;
	warnedShellFallback: boolean;
	notifiedBashSource: boolean;
	/**
	 * Sessions spawned but not yet inserted into the store (inside the
	 * early-exit grace window). session_shutdown must see these too —
	 * otherwise a shutdown racing exec_command orphans the child.
	 */
	pendingSessions: Set<ExecSession>;
	/** Set on session_shutdown; new exec_commands are rejected. */
	shuttingDown: boolean;
}

type ExecCommandArgs = {
	cmd: string;
	workdir?: string;
	shell?: string;
	tty?: boolean;
	yield_time_ms?: number;
	on_exit?: OnExitPolicy;
};

type WriteStdinArgs = {
	session_id: number;
	chars?: string;
	chars_b64?: string;
	yield_time_ms?: number;
	yield_until?: string;
};

/**
 * Resolve the two mutually-exclusive input channels (`chars` and
 * `chars_b64`) to a single byte payload. Throws on conflicts or malformed
 * base64.
 */
function resolveWriteInput(args: WriteStdinArgs): Uint8Array | undefined {
	const hasChars = typeof args.chars === "string" && args.chars.length > 0;
	const hasB64 = typeof args.chars_b64 === "string" && args.chars_b64.length > 0;
	if (hasChars && hasB64) {
		throw new Error("write_stdin: pass either `chars` or `chars_b64`, not both.");
	}
	if (hasB64) {
		const b64 = args.chars_b64!.replace(/\s+/g, "");
		if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
			throw new Error("write_stdin: `chars_b64` is not valid base64.");
		}
		return new Uint8Array(Buffer.from(b64, "base64"));
	}
	if (hasChars) {
		// Decode C-style escapes so the LLM can send \x03, \x1b, \n, etc.
		return encode(unescapeChars(args.chars!));
	}
	return undefined;
}

async function runExecCommand(
	ctx: ExtensionCtx,
	args: ExecCommandArgs,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: { content: [{ type: "text"; text: string }]; details: unknown }) => void) | undefined,
	cwd: string,
): Promise<ResponseShape> {
	if (ctx.shuttingDown) {
		throw new Error("unified-exec: session is shutting down; not starting new commands.");
	}
	const tty = args.tty ?? false;
	if (tty && !isPtyAvailable()) {
		throw new Error(
			`tty: true requires @homebridge/node-pty-prebuilt-multiarch but it failed to load: ${getPtyLoadError() ?? "unknown"}.\n` +
				`Run:  cd .pi/extensions/unified-exec && npm install\n` +
				`Or call with tty: false (default).`,
		);
	}

	let shellBin = args.shell;
	if (!shellBin) {
		const resolved = resolveDefaultShell();
		shellBin = resolved.shell;
		if (resolved.fellBack && !ctx.warnedShellFallback) {
			ctx.warnedShellFallback = true;
			ctx.ui?.notify(
				"unified-exec: no bash found (PATH, git-derived, or known install roots); falling back to powershell. Install Git Bash or set PI_UNIFIED_EXEC_BASH.",
				"warning",
			);
		} else if (
			!resolved.fellBack &&
			resolved.bashSource &&
			resolved.bashSource !== "path" &&
			resolved.bashSource !== "env" &&
			!ctx.notifiedBashSource
		) {
			// bash located off PATH (derived from git.exe or a known install
			// root) — say so once, so shell selection is never mysterious.
			ctx.notifiedBashSource = true;
			ctx.ui?.notify(`unified-exec: using bash at ${resolved.shell} (not on PATH)`, "info");
		}
	} else if (IS_WINDOWS) {
		// Resolve bare names to the absolute PATH match, failing closed —
		// Windows' CreateProcess checks the child's cwd (the LLM-supplied
		// workdir) before PATH for bare names, so an unresolved name must
		// never reach spawn.
		shellBin = resolveWindowsShell(shellBin);
	}
	const shellCommand = buildShellCommand(shellBin, args.cmd);
	const effectiveCwd = args.workdir && args.workdir.length > 0 ? args.workdir : cwd;
	const yieldTimeMs = clampYield(args.yield_time_ms, DEFAULT_EXEC_YIELD_MS);
	const wantsWake = args.on_exit === "wake";

	const id = ctx.store.allocateId();
	const session = ExecSession.spawn(id, {
		command: shellCommand.command,
		cwd: effectiveCwd,
		env: process.env,
		tty,
		displayCommand: args.cmd,
		shell: shellBin,
		windowsVerbatimArguments: shellCommand.windowsVerbatimArguments,
	});

	if (session.failureMessage) {
		ctx.store.releaseId(id);
		return finalizeResponse({
			wallTimeSec: 0,
			collected: new Uint8Array(0),
			sessionId: undefined,
			exitCode: -1,
			signal: null,
			failure: session.failureMessage,
			tty,
			logPath: undefined, // spawn failed — no log file
			cwd: effectiveCwd,
			command: args.cmd,
			yieldTimeMs,
		});
	}

	// Track the session from spawn to store-insertion: session_shutdown must
	// be able to terminate children that are still inside the grace window.
	ctx.pendingSessions.add(session);
	try {
	// Early-exit grace: if the process dies within 150 ms, treat it as a
	// short-lived command and never register it.
	const start = Date.now();
	const earlyDeadline = start + EARLY_EXIT_GRACE_PERIOD_MS;
	await Promise.race([
		new Promise<void>((resolve) => {
			if (session.hasExited) return resolve();
			session.exited.addEventListener("abort", () => resolve(), { once: true });
		}),
		sleep(EARLY_EXIT_GRACE_PERIOD_MS, signal),
	]);

	if (session.hasExited && Date.now() <= earlyDeadline + 20) {
		// Fully short-lived: collect everything in the buffer + any trailing bytes.
		// Use a small deadline to pick up anything still pending.
		const collected = await collectOutputUntilDeadline({
			buffer: session.outputBuffer,
			outputNotify: session.outputNotify,
			outputClosed: session.outputClosed,
			exited: session.exited,
			// macOS can deliver stdout/stderr shortly after the exit event for very
			// fast commands. Give the trailing drain a bounded but less brittle window.
			deadlineMs: Date.now() + 500,
			externalAbort: signal,
		});
		ctx.store.releaseId(id);
		const wallSec = (Date.now() - start) / 1000;
		return finalizeResponse({
			wallTimeSec: wallSec,
			collected,
			sessionId: undefined,
			exitCode: session.exitCode,
			signal: session.signal,
			failure: session.failureMessage,
			tty,
			logPath: session.logPath,
			cwd: effectiveCwd,
			command: args.cmd,
			yieldTimeMs,
			extra: { on_exit: args.on_exit },
		});
	}

	// Live session: register it BEFORE we keep polling, so an early abort
	// doesn't let the session be GC'd / lose its place.
	const { pruned, count } = ctx.store.insert(session);
	watchSessionExit(ctx, session);
	if (pruned) {
		unwatchSessionExit(ctx, pruned.id);
		// Suppresses the wake for live victims; keeps a tombstone for a
		// naturally-exited wake session so its completion is not silently lost.
		ctx.coordinator.handleEviction(pruned);
		ctx.ui?.notify(`unified-exec: evicted session ${pruned.id} (LRU, over cap ${ctx.store.maxSessions})`, "warning");
	}
	if (count >= WARNING_SESSIONS) {
		ctx.ui?.notify(`unified-exec: ${count}/${ctx.store.maxSessions} sessions open`, "warning");
	}
	// Note: sessions stay in the store until a later tool call observes the
	// exit: write_stdin returns the final exit_code/output, and list_sessions
	// reports exited sessions one last time (with exit info) before removing
	// them. Matches codex's lazy-drain so exit information is never silently
	// lost across turns.

	// Wait until the yield deadline (or abort/exit). Stream updates meanwhile.
	const deadlineMs = start + yieldTimeMs;
	const pollStream = startStreaming(session, onUpdate, deadlineMs, signal);
	const collected = await collectOutputUntilDeadline({
		buffer: session.outputBuffer,
		outputNotify: session.outputNotify,
		outputClosed: session.outputClosed,
		exited: session.exited,
		deadlineMs,
		externalAbort: signal,
	});
	pollStream.stop();

	session.touch();
	const stillAlive = !session.hasExited;
	const wallSec = (Date.now() - start) / 1000;

	if (stillAlive) {
		// COMMIT POINT for on_exit: "wake" — we are now returning a background
		// session_id, so arm the wake. If the process exits a moment after this
		// check, the coordinator's exit listener (which fires even for
		// already-exited sessions) still delivers the completion exactly once.
		if (wantsWake) ctx.coordinator.register(session);
		return finalizeResponse({
			wallTimeSec: wallSec,
			collected,
			sessionId: session.id,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty,
			logPath: session.logPath,
			cwd: effectiveCwd,
			command: args.cmd,
			yieldTimeMs,
			extra: {
				on_exit: args.on_exit,
				...(wantsWake ? { completion_notification: "armed" as const } : {}),
				tool_time_utc: nowUtcIso(),
			},
		});
	}
	// Process exited during this call → respond with exit info, not a
	// session_id. The wake is never armed: the exit was delivered directly.
	removeSession(ctx, session.id);
	return finalizeResponse({
		wallTimeSec: wallSec,
		collected,
		sessionId: undefined,
		exitCode: session.exitCode,
		signal: session.signal,
		failure: session.failureMessage,
		tty,
		logPath: session.logPath,
		cwd: effectiveCwd,
		command: args.cmd,
		yieldTimeMs,
		extra: { on_exit: args.on_exit },
	});
	} finally {
		ctx.pendingSessions.delete(session);
	}
}

async function runWriteStdin(
	ctx: ExtensionCtx,
	args: WriteStdinArgs,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: { content: [{ type: "text"; text: string }]; details: unknown }) => void) | undefined,
	toolCallId: string,
): Promise<ResponseShape> {
	const session = ctx.store.get(args.session_id);
	if (!session) {
		throw new Error(`unknown session_id: ${args.session_id}`);
	}
	const writeBytes = resolveWriteInput(args);
	const isEmptyPoll = writeBytes === undefined || writeBytes.length === 0;
	const hasYieldUntil = typeof args.yield_until === "string" && args.yield_until.length > 0;

	// `yield_time_ms` (relative, cache-friendly, ≤290 s) and `yield_until`
	// (absolute UTC deadline) are never both accepted.
	if (hasYieldUntil && args.yield_time_ms !== undefined) {
		throw new Error(
			`write_stdin: pass either yield_time_ms (relative wait, max ${resolveMaxEmptyPollMs()} ms) or ` +
				`yield_until (absolute UTC deadline), not both. tool_time_utc: ${nowUtcIso()}`,
		);
	}
	// `yield_until` is only valid for an empty poll (no input bytes).
	if (hasYieldUntil && !isEmptyPoll) {
		throw new Error(
			`write_stdin: yield_until is only valid for an empty poll (no non-empty chars or chars_b64). ` +
				`Send the input with a relative yield_time_ms first, then follow up with an empty yield_until poll. ` +
				`tool_time_utc: ${nowUtcIso()}`,
		);
	}
	if (hasYieldUntil) {
		return runAbsoluteWait(ctx, session, args.yield_until!, signal, onUpdate, toolCallId);
	}

	const yieldTimeMs = isEmptyPoll
		? resolveEmptyPollYield(args.yield_time_ms)
		: clampYield(args.yield_time_ms, DEFAULT_WRITE_STDIN_YIELD_MS);

	const start = Date.now();
	session.touch();

	// Observation lease: while this call may return terminal status, a
	// concurrent exit is held instead of enqueuing a wake (see completion.ts).
	ctx.coordinator.beginObservation(session.id, toolCallId);
	try {
		let writeFailure: string | null = null;
		if (!isEmptyPoll && writeBytes) {
			const ok = session.write(writeBytes);
			if (!ok && !session.hasExited) {
				// Still running but stdin is gone (child closed it / EPIPE earlier).
				writeFailure = "stdin write failed: the child closed its stdin; bytes were not delivered";
			}
			if (!ok && session.hasExited) {
				// Session already exited; return its final state.
				const collected = await collectOutputUntilDeadline({
					buffer: session.outputBuffer,
					outputNotify: session.outputNotify,
					outputClosed: session.outputClosed,
					exited: session.exited,
					deadlineMs: Date.now() + 50,
					externalAbort: signal,
				});
				const armed = ctx.coordinator.isArmed(session.id);
				removeSession(ctx, session.id);
				ctx.coordinator.markPendingTerminal(session.id, toolCallId);
				const wallSec = (Date.now() - start) / 1000;
				return finalizeResponse({
					wallTimeSec: wallSec,
					collected,
					sessionId: undefined,
					exitCode: session.exitCode,
					signal: session.signal,
					failure: session.failureMessage,
					tty: session.tty,
					logPath: session.logPath,
					cwd: session.cwd,
					command: session.displayCommand,
					yieldTimeMs,
					// This path is only reachable for input writes (never an empty
					// poll), so no wait_mode is reported — just direct delivery.
					extra: terminalWaitExtra(undefined, armed),
				});
			}
			// Give the child a small window to react before the poll.
			await sleep(100, signal);
		}

		const deadlineMs = start + yieldTimeMs;
		const pollStream = startStreaming(session, onUpdate, deadlineMs, signal);
		const collected = await collectOutputUntilDeadline({
			buffer: session.outputBuffer,
			outputNotify: session.outputNotify,
			outputClosed: session.outputClosed,
			exited: session.exited,
			deadlineMs,
			externalAbort: signal,
		});
		pollStream.stop();
		const wallSec = (Date.now() - start) / 1000;

		if (session.hasExited) {
			const armed = ctx.coordinator.isArmed(session.id);
			removeSession(ctx, session.id);
			// Terminal result constructed: keep the lease until Pi finalizes it
			// (tool_execution_end) so an error/cancelled finalization keeps the
			// completion wake-eligible.
			ctx.coordinator.markPendingTerminal(session.id, toolCallId);
			return finalizeResponse({
				wallTimeSec: wallSec,
				collected,
				sessionId: undefined,
				exitCode: session.exitCode,
				signal: session.signal,
				failure: session.failureMessage ?? writeFailure,
				tty: session.tty,
				logPath: session.logPath,
				cwd: session.cwd,
				command: session.displayCommand,
				yieldTimeMs,
				extra: terminalWaitExtra(isEmptyPoll ? "relative" : undefined, armed),
			});
		}
		// Still running: release the lease WITHOUT marking observed — the wake
		// (if armed) stays eligible.
		const armed = ctx.coordinator.isArmed(session.id);
		ctx.coordinator.releaseObservation(session.id, toolCallId);
		return finalizeResponse({
			wallTimeSec: wallSec,
			collected,
			sessionId: session.id,
			exitCode: undefined,
			signal: null,
			failure: writeFailure,
			tty: session.tty,
			logPath: session.logPath,
			cwd: session.cwd,
			command: session.displayCommand,
			yieldTimeMs,
			extra: {
				...(isEmptyPoll
					? {
							wait_mode: "relative" as const,
							wait_status: signal?.aborted ? ("cancelled" as const) : ("relative_deadline_reached" as const),
						}
					: {}),
				tool_time_utc: nowUtcIso(),
				...(armed ? { on_exit: "wake" as const, completion_notification: "armed" as const } : {}),
			},
		});
	} catch (err) {
		// Handler failure: release the lease so the wake stays eligible.
		ctx.coordinator.releaseObservation(session.id, toolCallId);
		throw err;
	}
}

/** Shared "exited" extra fields for direct terminal delivery. */
function terminalWaitExtra(
	waitMode: "relative" | "absolute" | undefined,
	wakeWasArmed: boolean,
): Partial<ResponseShape> {
	return {
		wait_mode: waitMode,
		wait_status: waitMode ? ("completed" as const) : undefined,
		completion_delivery: "direct",
		tool_time_utc: nowUtcIso(),
		...(wakeWasArmed ? { on_exit: "wake" as const, on_exit_wake: "consumed" as const } : {}),
	};
}

/**
 * Absolute-deadline wait (`yield_until`): stay attached, event-driven, until
 * the process exits, the tool call is cancelled, or the UTC deadline arrives.
 *
 * Unlike relative polls this NEVER drains output while waiting (a 10-hour
 * noisy process must not accumulate unbounded history in this call); the
 * session machinery keeps its bounded head/tail buffer, rolling UI tail, and
 * complete on-disk log.
 */
async function runAbsoluteWait(
	ctx: ExtensionCtx,
	session: ExecSession,
	yieldUntilRaw: string,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: { content: [{ type: "text"; text: string }]; details: unknown }) => void) | undefined,
	toolCallId: string,
): Promise<ResponseShape> {
	const startMs = Date.now();
	// Parse/validate the wall-clock instant and compute the remaining duration
	// ONCE; the wait below runs purely on the monotonic clock.
	const parsed = parseYieldUntil(yieldUntilRaw, startMs);
	session.touch();

	// Observation lease (see completion.ts): exit is held while we observe.
	ctx.coordinator.beginObservation(session.id, toolCallId);

	// No 250 ms heartbeat for hours: one initial update, heavily rate-limited
	// output-driven updates from a NON-destructive tail snapshot, one final.
	const streamer = onUpdate
		? startRateLimitedStream({
				outputNotify: session.outputNotify,
				minIntervalMs: LONG_WAIT_UPDATE_INTERVAL_MS,
				emit: () => {
					const tailText = decode(session.snapshotStreamTail());
					onUpdate({
						content: [{ type: "text", text: tailText }],
						details: {
							session_id: session.id,
							pid: session.pid,
							running: !session.hasExited,
							total_bytes: session.totalBytesSeen,
							tty: session.tty,
							command: session.displayCommand,
							cwd: session.cwd,
							log_path: session.logPath,
							yield_until: parsed.normalized,
							output: tailText,
						},
					});
				},
			})
		: undefined;

	let outcome: LongWaitOutcome;
	try {
		outcome = await waitForExitOrDeadline({
			exited: session.exited,
			externalAbort: signal,
			durationMs: parsed.remainingMs,
		});
	} catch (err) {
		ctx.coordinator.releaseObservation(session.id, toolCallId);
		streamer?.stop();
		throw err;
	}
	streamer?.stop();

	// Exit wins close races: if the session is already terminal when the result
	// is assembled, deliver the terminal result regardless of which event won.
	if (session.hasExited) outcome = "exit";
	const armed = ctx.coordinator.isArmed(session.id);

	if (outcome === "exit") {
		// Let trailing stdout/stderr and the log flush settle (outputClosed),
		// then drain the bounded retained output once. externalAbort is
		// deliberately NOT passed: exit won, and the bounded final drain must
		// complete even if cancellation fired at the same instant.
		const collected = await collectOutputUntilDeadline({
			buffer: session.outputBuffer,
			outputNotify: session.outputNotify,
			outputClosed: session.outputClosed,
			exited: session.exited,
			deadlineMs: Date.now() + 1000,
		});
		removeSession(ctx, session.id);
		ctx.coordinator.markPendingTerminal(session.id, toolCallId);
		return finalizeResponse({
			wallTimeSec: (Date.now() - startMs) / 1000,
			collected,
			sessionId: undefined,
			exitCode: session.exitCode,
			signal: session.signal,
			failure: session.failureMessage,
			tty: session.tty,
			logPath: session.logPath,
			cwd: session.cwd,
			command: session.displayCommand,
			extra: {
				...terminalWaitExtra("absolute", armed),
				yield_until: parsed.normalized,
			},
		});
	}

	if (outcome === "cancelled") {
		// Do NOT drain: if pi discards the result of a cancelled call, drained
		// output would be lost. Buffered + logged output stays with the session,
		// and the process survives. The wake (if armed) stays eligible.
		ctx.coordinator.releaseObservation(session.id, toolCallId);
		return finalizeResponse({
			wallTimeSec: (Date.now() - startMs) / 1000,
			collected: new Uint8Array(0),
			sessionId: session.id,
			exitCode: undefined,
			signal: null,
			failure: null,
			tty: session.tty,
			logPath: session.logPath,
			cwd: session.cwd,
			command: session.displayCommand,
			extra: {
				wait_mode: "absolute" as const,
				wait_status: "cancelled" as const,
				yield_until: parsed.normalized,
				tool_time_utc: nowUtcIso(),
				...(armed ? { on_exit: "wake" as const, completion_notification: "armed" as const } : {}),
			},
		});
	}

	// Absolute deadline reached while still running: one bounded drain
	// (ordinary poll semantics), release the lease, keep the wake armed.
	const collected = await collectOutputUntilDeadline({
		buffer: session.outputBuffer,
		outputNotify: session.outputNotify,
		outputClosed: session.outputClosed,
		exited: session.exited,
		deadlineMs: Date.now(),
		externalAbort: signal,
	});
	session.touch();
	ctx.coordinator.releaseObservation(session.id, toolCallId);
	return finalizeResponse({
		wallTimeSec: (Date.now() - startMs) / 1000,
		collected,
		sessionId: session.id,
		exitCode: undefined,
		signal: null,
		failure: null,
		tty: session.tty,
		logPath: session.logPath,
		cwd: session.cwd,
		command: session.displayCommand,
		extra: {
			wait_mode: "absolute" as const,
			wait_status: "absolute_deadline_reached" as const,
			yield_until: parsed.normalized,
			effective_wait_ms: Date.now() - startMs,
			tool_time_utc: nowUtcIso(),
			...(armed ? { on_exit: "wake" as const, completion_notification: "armed" as const } : {}),
		},
	});
}

/** Result of terminating a session via kill_session or the sessions command. */
interface TerminateOutcome {
	session: ExecSession;
	escalated: boolean;
	finalOutput: string;
	/** true when the process is confirmed dead; false = kill did NOT land. */
	killed: boolean;
}

/**
 * Kill a session (initial signal → 2s grace → SIGKILL escalation), drain its
 * trailing output, and remove it from the store — but ONLY on confirmed
 * exit. A kill that doesn't land (taskkill failure, access denied,
 * unkillable state) keeps the session in the store and returns
 * killed: false, so ownership of a live process is never silently dropped.
 * Shared by the kill_session tool and the /unified-exec-sessions command.
 */
async function terminateSessionById(
	ctx: ExtensionCtx,
	sid: number,
	initial: NodeJS.Signals,
): Promise<TerminateOutcome | undefined> {
	const session = ctx.store.get(sid);
	if (!session) return undefined;
	// Explicit kill (model tool or human slash command): suppress the wake
	// BEFORE signaling so the induced exit can never race a wake enqueue.
	ctx.coordinator.suppress(sid);
	session.kill(initial);
	// Wait up to 2s for exit.
	const exitDeadline = Date.now() + 2000;
	while (!session.hasExited && Date.now() < exitDeadline) {
		await sleep(50);
	}
	let escalated = false;
	// On Windows every kill is already a force tree-kill (taskkill /T /F);
	// a "SIGKILL escalation" would spawn a byte-identical taskkill that
	// cannot behave differently, so skip it there.
	if (!session.hasExited && !IS_WINDOWS) {
		session.kill("SIGKILL");
		escalated = true;
		const kdeadline = Date.now() + 500;
		while (!session.hasExited && Date.now() < kdeadline) {
			await sleep(25);
		}
	}
	// Final drain.
	const collected = await collectOutputUntilDeadline({
		buffer: session.outputBuffer,
		outputNotify: session.outputNotify,
		outputClosed: session.outputClosed,
		exited: session.exited,
		deadlineMs: Date.now() + 100,
	});
	const killed = session.hasExited;
	if (killed) {
		ctx.coordinator.confirmKill(sid);
		removeSession(ctx, sid);
	} else {
		// The kill did NOT land — the process is still alive and still owned.
		// Restore its prior wake eligibility.
		ctx.coordinator.restoreAfterFailedKill(sid);
	}
	return { session, escalated, finalOutput: decode(collected), killed };
}

interface FinalizeInput {
	wallTimeSec: number;
	collected: Uint8Array;
	sessionId: number | undefined;
	exitCode: number | null | undefined;
	signal: NodeJS.Signals | null;
	failure: string | null;
	tty: boolean;
	logPath: string | undefined;
	cwd?: string;
	command?: string;
	yieldTimeMs?: number;
	/** Long-wait / wake metadata merged into the shape (undefined values skipped). */
	extra?: Partial<ResponseShape>;
}

function finalizeResponse(input: FinalizeInput): ResponseShape {
	const { wallTimeSec, collected, sessionId, exitCode, signal, failure, tty, logPath, cwd, command, yieldTimeMs } = input;
	const rawText = decode(collected);
	const originalTokens = approxTokenCount(collected);
	const truncation = truncateTail(rawText, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
	const shape: ResponseShape = {
		chunk_id: generateChunkId(),
		wall_time_seconds: wallTimeSec,
		output: truncation.content,
		original_token_count: originalTokens,
		tty,
	};
	if (sessionId !== undefined) shape.session_id = sessionId;
	if (exitCode !== undefined && exitCode !== null) shape.exit_code = exitCode;
	if (signal) shape.signal = signal;
	if (failure) shape.failure_message = failure;
	if (logPath) shape.log_path = logPath;
	if (cwd) shape.cwd = cwd;
	if (command) shape.command = command;
	if (yieldTimeMs) shape.yield_time_ms = yieldTimeMs;
	if (truncation.truncated) shape.truncation = truncation;
	if (input.extra) {
		for (const [key, value] of Object.entries(input.extra)) {
			if (value !== undefined) (shape as unknown as Record<string, unknown>)[key] = value;
		}
	}
	return shape;
}

function runningSessions(ctx: ExtensionCtx): ExecSession[] {
	return ctx.store
		.values()
		.filter((s) => !s.hasExited)
		.sort((a, b) => a.id - b.id);
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
	return n === 1 ? singular : pluralForm;
}

function oneLineCommand(command: string, max = 120): string {
	const oneLine = command.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function formatRunningSessionsWidget(ctx: ExtensionCtx, sessions: ExecSession[]): string[] {
	const now = Date.now();
	const shown = sessions.slice(0, 5);
	const lines = [
		`⚠ unified-exec: ${sessions.length} ${plural(sessions.length, "session")} still running`,
		...shown.map((s) => {
			const wake = ctx.coordinator.isArmed(s.id) ? " ⏰wake" : "";
			return `  #${s.id} ${formatElapsed(now - s.startedAt)}${wake} ${oneLineCommand(s.displayCommand, 72)} (${s.cwd})`;
		}),
	];
	if (sessions.length > shown.length) lines.push(`  … ${sessions.length - shown.length} more; use list_sessions`);
	lines.push("  Use list_sessions, write_stdin, set_on_exit (disarm wake), or kill_session.");
	return lines;
}

function updateRunningSessionsUi(ctx: ExtensionCtx, opts: { showWidget?: boolean; notifyTree?: boolean } = {}): void {
	const ui = ctx.ui;
	if (!ui) return;
	const sessions = runningSessions(ctx);
	const status = sessions.length ? `unified-exec: ${sessions.length} ${plural(sessions.length, "session")} running` : undefined;
	ui.setStatus(SESSION_UI_KEY, status);

	if (opts.notifyTree && sessions.length > 0) {
		ui.notify(
			`unified-exec: ${sessions.length} ${plural(sessions.length, "session")} still running after /tree.`,
			"warning",
		);
	}

	const setWidget = (ui as any).setWidget as
		| ((key: string, content: string[] | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }) => void)
		| undefined;
	if (!setWidget) return;

	if (sessions.length === 0) {
		if (ctx.widgetVisible) {
			setWidget.call(ui, SESSION_UI_KEY, undefined);
			ctx.widgetVisible = false;
		}
		return;
	}

	if (opts.showWidget || ctx.widgetVisible) {
		setWidget.call(ui, SESSION_UI_KEY, formatRunningSessionsWidget(ctx, sessions), { placement: "aboveEditor" });
		ctx.widgetVisible = true;
	}
}

function watchSessionExit(ctx: ExtensionCtx, session: ExecSession): void {
	ctx.exitUnsubscribers.get(session.id)?.();
	const unsubscribe = session.onExit(() => {
		// Preserve lazy-drain semantics: an exited session stays in the store until
		// write_stdin/list_sessions/kill_session observes it. The UI only reflects
		// currently running processes.
		updateRunningSessionsUi(ctx);
	});
	ctx.exitUnsubscribers.set(session.id, unsubscribe);
}

function unwatchSessionExit(ctx: ExtensionCtx, id: number): void {
	ctx.exitUnsubscribers.get(id)?.();
	ctx.exitUnsubscribers.delete(id);
}

function removeSession(ctx: ExtensionCtx, id: number): ExecSession | undefined {
	unwatchSessionExit(ctx, id);
	return ctx.store.remove(id);
}

function clearSessionExitWatchers(ctx: ExtensionCtx): void {
	for (const unsubscribe of ctx.exitUnsubscribers.values()) {
		unsubscribe();
	}
	ctx.exitUnsubscribers.clear();
}

function startStreaming(
	session: ExecSession,
	onUpdate: ((partial: { content: [{ type: "text"; text: string }]; details: unknown }) => void) | undefined,
	deadlineMs: number,
	externalAbort: AbortSignal | undefined,
): { stop: () => void } {
	if (!onUpdate) return { stop: () => {} };
	let stopped = false;
	const tick = () => {
		if (stopped) return;
		try {
			const tail = session.snapshotStreamTail();
			const tailText = decode(tail);
			onUpdate({
				content: [{ type: "text", text: tailText }],
				details: {
					session_id: session.id,
					pid: session.pid,
					running: !session.hasExited,
					total_bytes: session.totalBytesSeen,
					tty: session.tty,
					command: session.displayCommand,
					cwd: session.cwd,
					log_path: session.logPath,
					// Populate `output` so renderResult has a single source regardless
					// of streaming vs final state.
					output: tailText,
				},
			});
		} catch {
			// ignore transient errors
		}
		if (stopped) return;
		if (Date.now() >= deadlineMs) return;
		if (externalAbort?.aborted) return;
		interval = setTimeout(tick, OUTPUT_POLL_INTERVAL_MS);
	};
	let interval: NodeJS.Timeout | undefined = setTimeout(tick, OUTPUT_POLL_INTERVAL_MS);
	return {
		stop: () => {
			stopped = true;
			if (interval) clearTimeout(interval);
		},
	};
}

export default function (pi: ExtensionAPI) {
	const coordinator = new CompletionCoordinator({
		send: (message) => {
			// If pi is idle this starts a model turn; if a run is active it is
			// queued as a follow-up — never steering/interrupting the current turn.
			pi.sendMessage(
				{
					customType: "unified-exec-completed",
					content: message.content,
					display: true,
					details: message.details,
				},
				{ triggerTurn: true, deliverAs: "followUp" },
			);
		},
		onSendError: (err) => {
			ctx.ui?.notify(
				`unified-exec: failed to deliver completion notification: ${err instanceof Error ? err.message : String(err)}`,
				"warning",
			);
		},
	});
	const ctx: ExtensionCtx = {
		coordinator,
		store: new SessionStore({
			maxSessions: MAX_SESSIONS,
			lruProtectedCount: LRU_PROTECTED_COUNT,
			onEvict: (s, reason) => {
				if (reason === "lru") {
					// Status clear + warning handled at insert-site; no-op here.
				}
			},
		}),
		ui: undefined,
		widgetVisible: false,
		exitUnsubscribers: new Map(),
		warnedShellFallback: false,
		notifiedBashSource: false,
		pendingSessions: new Set(),
		shuttingDown: false,
	};

	// By default, unified-exec removes pi's built-in `bash` tool so the LLM
	// is steered toward exec_command/write_stdin. Pass --keep-builtin-bash to
	// preserve the built-in alongside the unified-exec tools.
	pi.registerFlag("keep-builtin-bash", {
		description: "Keep pi's built-in `bash` tool alongside exec_command/write_stdin. By default it is removed.",
		type: "boolean",
		default: false,
	});

	// Observation finalization: "observed" is committed at pi's finalized
	// tool-result event, not merely when the handler returns — see completion.ts.
	pi.on("tool_execution_end", async (event) => {
		ctx.coordinator.handleToolExecutionEnd(event.toolCallId, event.isError === true);
	});
	// agent_settled (pi >= 0.80.5, our peer minimum) is a safe point to flush
	// pending completions (e.g. retry a failed send). Wrapped so an older
	// runtime that rejects unknown events degrades gracefully — wakes still
	// deliver via the debounce timer and tool boundaries.
	try {
		pi.on("agent_settled", async () => {
			ctx.coordinator.flushPending();
		});
	} catch {
		// pi < 0.80.5: no agent_settled event — non-fatal.
	}

	pi.on("session_start", async (_event, eventCtx) => {
		ctx.ui = eventCtx.ui;
		ctx.shuttingDown = false; // reload/new/resume re-arms the extension
		ctx.coordinator.reset(); // never resurrect wakes from a previous session
		updateRunningSessionsUi(ctx);
		// Default behavior is to remove the built-in `bash` tool. Only keep it
		// if --keep-builtin-bash was passed. Flag lookup uses the registered
		// name without leading dashes.
		const keep = pi.getFlag("keep-builtin-bash") ?? pi.getFlag("--keep-builtin-bash");
		if (keep !== true) {
			const active = pi.getActiveTools();
			const filtered = active.filter((name) => name !== "bash");
			if (filtered.length !== active.length) {
				pi.setActiveTools(filtered);
			}
		}
		if (!isPtyAvailable() && eventCtx.hasUI) {
			// Non-fatal: pipes mode still works.
			eventCtx.ui.notify(
				"unified-exec: node-pty not available; tty: true will fail. Pipes (tty: false) still work.",
				"info",
			);
		}
	});

	pi.on("session_tree", async (_event, eventCtx) => {
		ctx.ui = eventCtx.ui;
		updateRunningSessionsUi(ctx, { showWidget: true, notifyTree: runningSessions(ctx).length > 0 });
	});

	pi.on("session_shutdown", async () => {
		// Reject new sessions from here on and terminate everything we own —
		// including sessions still inside exec_command's early-exit grace
		// window (spawned but not yet inserted into the store).
		ctx.shuttingDown = true;
		// Cancel wake timers/listeners first: no stale prompt may ever be
		// injected into a new or closed session.
		ctx.coordinator.shutdown();
		const drained = ctx.store.terminateAll();
		for (const s of ctx.pendingSessions) {
			if (!s.hasExited) {
				s.terminate();
				drained.push(s);
			}
		}
		clearSessionExitWatchers(ctx);
		updateRunningSessionsUi(ctx);
		// Children run detached (own process groups), so anything that ignores
		// SIGTERM would outlive pi as an orphan. Give them a short grace, then
		// SIGKILL survivors and wait briefly for confirmation. On Windows the
		// initial kill is already a force tree-kill and a second taskkill is
		// byte-identical, so skip the escalation there (the grace wait above
		// still confirms exits).
		const graceDeadline = Date.now() + 1000;
		while (drained.some((s) => !s.hasExited) && Date.now() < graceDeadline) {
			await sleep(50);
		}
		if (!IS_WINDOWS) {
			const survivors = drained.filter((s) => !s.hasExited);
			for (const s of survivors) s.kill("SIGKILL");
			if (survivors.length) {
				const killDeadline = Date.now() + 500;
				while (drained.some((s) => !s.hasExited) && Date.now() < killDeadline) {
					await sleep(25);
				}
			}
		}
		if (drained.length && ctx.ui) {
			const leftover = drained.filter((s) => !s.hasExited).length;
			ctx.ui.notify(
				`unified-exec: terminated ${drained.length - leftover} live session(s) on shutdown` +
					(leftover ? `; ${leftover} did not confirm exit` : ""),
				 leftover ? "warning" : "info",
			);
		}
	});

	// Human-facing escape hatch: inspect and kill live sessions without going
	// through the model.
	pi.registerCommand("unified-exec-sessions", {
		description: "List live unified-exec sessions and optionally kill one (or all)",
		handler: async (_args, cmdCtx) => {
			ctx.ui = cmdCtx.ui;
			// Reap silently-exited sessions first so the picker only shows live ones.
			for (const s of ctx.store.values()) {
				if (s.hasExited) removeSession(ctx, s.id);
			}
			updateRunningSessionsUi(ctx);
			const sessions = runningSessions(ctx);
			if (sessions.length === 0) {
				cmdCtx.ui.notify("unified-exec: no live sessions", "info");
				return;
			}
			const now = Date.now();
			const labels = sessions.map((s) => {
				const wake = ctx.coordinator.isArmed(s.id) ? " ⏰wake" : "";
				return `#${s.id} ${formatElapsed(now - s.startedAt)}${wake} ${oneLineCommand(s.displayCommand, 60)}`;
			});
			const KILL_ALL = `Kill all ${sessions.length} ${plural(sessions.length, "session")}`;
			const choice = await cmdCtx.ui.select(
				`unified-exec: ${sessions.length} live ${plural(sessions.length, "session")} — select to kill (Esc to cancel)`,
				[...labels, KILL_ALL],
			);
			if (!choice) return;
			const targets = choice === KILL_ALL ? sessions : sessions.filter((s) => choice.startsWith(`#${s.id} `));
			let killed = 0;
			let failed = 0;
			for (const s of targets) {
				const outcome = await terminateSessionById(ctx, s.id, "SIGTERM");
				if (outcome?.killed) killed++;
				else if (outcome) failed++;
			}
			updateRunningSessionsUi(ctx);
			cmdCtx.ui.notify(
				`unified-exec: killed ${killed} ${plural(killed, "session")}` +
					(failed ? `; ${failed} did not confirm exit (still listed)` : ""),
				failed ? "warning" : "info",
			);
		},
	});

	// ---------------- Tools ----------------

	pi.registerTool({
		name: "exec_command",
		label: "exec_command",
		description:
			'Run a command in a persistent session. Returns `session_id` if still running (drive with write_stdin) or `exit_code` if it finished within yield_time_ms. on_exit defaults to "none". Only pass on_exit: "wake" when the human explicitly wants auto-resume on unobserved exit — stale wakes interrupt later work. Use set_on_exit to disarm or re-arm a running session.',
		promptSnippet: "Run a shell command; long-running ones yield a session_id",
		promptGuidelines: [
			"Prefer dedicated file tools when available (read/grep/find/ls). Otherwise use exec_command with fast shell tools: rg for content search, fd if available (or find) for file names, and ls for directories.",
			"Use a small yield_time_ms (~500ms) for quick one-shots and the 10s default for most commands; long-running or interactive processes (dev servers, REPLs, ssh, sudo) return a session_id you then drive with write_stdin.",
			`For background progress on long non-interactive commands, start with a short yield to obtain a session_id, then use empty write_stdin polls with yield_time_ms up to 290 seconds (${DEFAULT_MAX_BACKGROUND_POLL_MS} ms, cache-friendly); repeat polls as needed. Do NOT use yield_until just to bypass the 290s cap — only when the human explicitly asks for a long attached wait or a wall-clock deadline (finite non-interactive jobs only).`,
			'on_exit defaults to "none". Prefer polling or human follow-up. Use on_exit: "wake" ONLY when the human explicitly wants auto-resume on unobserved completion — not for indefinite processes (dev servers, watchers). If you armed wake by mistake or the job is wrong/abandoned, call set_on_exit(session_id, on_exit: "none") promptly (does not kill the process). kill_session still kills and suppresses wake. Combining wake with an observing write_stdin is safe: direct completion consumes the wake.',
		],
		parameters: Type.Object({
			cmd: Type.String({ description: "Shell command to execute." }),
			workdir: Type.Optional(Type.String({ description: "Working directory. Defaults to the session cwd." })),
			shell: Type.Optional(
				Type.String({
					description:
						"Shell binary. Defaults to bash (on Windows: bash if on PATH, else powershell). cmd and powershell/pwsh get shell-appropriate flags.",
				}),
			),
			tty: Type.Optional(Type.Boolean({ description: "Allocate a PTY. Default false (plain pipes)." })),
			yield_time_ms: Type.Optional(
				Type.Number({
					description: `How long (ms) this call stays attached waiting for output before yielding — an attachment window, not the command's lifetime or completion timeout. Default ${DEFAULT_EXEC_YIELD_MS}, clamped to [${MIN_YIELD_TIME_MS}, ${MAX_YIELD_TIME_MS}].`,
				}),
			),
			on_exit: Type.Optional(
				StringEnum(
					["none", "wake"] as const,
					'"none" (default): no auto-resume; poll with write_stdin. "wake": ONE follow-up notification on unobserved exit that resumes the agent — only when the human explicitly wants auto-resume. Change later via set_on_exit. A completion observed directly by a tool result consumes the wake.',
				),
			),
		}),
		async execute(_toolCallId, params, signal, onUpdate, eventCtx) {
			ctx.ui ??= eventCtx.ui;
			const shape = await runExecCommand(ctx, params as ExecCommandArgs, signal, onUpdate as any, eventCtx.cwd);
			updateRunningSessionsUi(ctx);
			return {
				content: [{ type: "text", text: renderResponseText(shape) }],
				details: shape,
			};
		},
		renderCall: renderExecCommandCall as any,
		renderResult: renderResult as any,
	});

	pi.registerTool({
		name: "write_stdin",
		label: "write_stdin",
		description:
			"Write bytes to a running session. Omit both chars and chars_b64 to poll without writing. Use `chars` for text with C-style escapes (e.g. \\x03 Ctrl-C, \\x1b ESC, \\n newline); use `chars_b64` for raw binary. For empty polls, wait with yield_time_ms (relative, max 290 s) or yield_until (absolute UTC deadline — only when the human explicitly asks for a long attached wait).",
		promptSnippet: "Send input to or poll a running session",
		promptGuidelines: [
			`Use yield_time_ms for interaction or an empty progress poll of at most 290 seconds (${DEFAULT_MAX_BACKGROUND_POLL_MS} ms, cache-friendly). Larger values are rejected, not clamped. Repeat polls as needed instead of bypassing the cap.`,
			'Use yield_until ONLY when the human explicitly asks for a long attached wait or an explicit UTC deadline. Omit yield_time_ms and pass a future UTC timestamp ending in "Z" (compute it from tool_time_utc in tool results). Finite non-interactive sessions only. Do NOT use yield_until just to bypass the 290s cap. The call returns immediately when the process exits.',
			"NEVER use yield_until for REPLs, sudo, ssh, password prompts, dev servers, file watchers, debuggers, or any indefinite/interactive session — it is only for finite commands that will exit on their own.",
			'on_exit wake is set via exec_command or set_on_exit, not write_stdin. Observing an exit here consumes an armed wake (direct result). To disarm wake without killing, call set_on_exit(session_id, on_exit: "none").',
			"In tty sessions, submit lines with \\r (the Enter key) rather than \\n: POSIX terminals accept both, but Windows console programs only execute input on \\r.",
			"For very noisy jobs, rely on the log_path and final/truncated output instead of repeatedly polling.",
		],
		parameters: Type.Object({
			session_id: Type.Number({ description: "Session id from exec_command." }),
			chars: Type.Optional(
				Type.String({
					description:
						"Text with C-style escapes: \\xHH, \\uHHHH, \\u{H\u2026}, \\n \\r \\t \\0 \\a \\e \\b \\f \\v \\\\ \\\". Unknown \\X preserved literally. Mutually exclusive with chars_b64.",
				}),
			),
			chars_b64: Type.Optional(
				Type.String({
					description: "Raw bytes (base64) to write. Mutually exclusive with chars.",
				}),
			),
			yield_time_ms: Type.Optional(
				Type.Number({
					description: `How long (ms) this call stays attached before yielding — an attachment/progress window, not the process's lifetime or completion timeout. Default ${DEFAULT_WRITE_STDIN_YIELD_MS}; for empty input clamped to [${MIN_EMPTY_YIELD_TIME_MS}, ${resolveMaxEmptyPollMs()}]; larger empty-poll values are rejected (use yield_until only if the human explicitly asked for a long wait). Mutually exclusive with yield_until.`,
				}),
			),
			yield_until: Type.Optional(
				Type.String({
					description:
						'Absolute UTC deadline to stay attached to an EMPTY poll, as strict RFC 3339 UTC ("2026-07-21T18:30:00Z" or with .mmm; uppercase Z, full date+time with seconds; no offsets). Only when the human explicitly asks for a long attached wait. Returns immediately when the process exits. No default max horizon. Mutually exclusive with yield_time_ms and with input bytes.',
				}),
			),
		}),
		async execute(toolCallId, params, signal, onUpdate, eventCtx) {
			ctx.ui ??= eventCtx.ui;
			const shape = await runWriteStdin(ctx, params as WriteStdinArgs, signal, onUpdate as any, toolCallId);
			updateRunningSessionsUi(ctx);
			return {
				content: [{ type: "text", text: renderResponseText(shape) }],
				details: shape,
			};
		},
		renderCall: renderWriteStdinCall as any,
		renderResult: renderResult as any,
	});

	pi.registerTool({
		name: "set_on_exit",
		label: "set_on_exit",
		description:
			'Change on_exit policy for a session without killing it. on_exit: "none" disarms a pending wake (including coordinator tombstones after eviction). on_exit: "wake" arms auto-resume if the process is still running. Cannot recall a follow-up already queued to the agent. kill_session both kills and suppresses.',
		promptSnippet: "Disarm or re-arm on_exit wake for a session",
		promptGuidelines: [
			'Default on_exit is "none". If you set "wake" and no longer need auto-resume (wrong command, user moved on, abandoned approach), call set_on_exit with "none" promptly — do not leave stale wakes armed.',
			"This does not stop the process. Use kill_session to terminate.",
			"Prefer arming wake only when the human explicitly asked for auto-resume.",
			"Disarm cannot recall a completion follow-up that was already delivered to pi.",
		],
		parameters: Type.Object({
			session_id: Type.Number({ description: "Session id from exec_command." }),
			on_exit: StringEnum(
				["none", "wake"] as const,
				'"none": disarm wake (process keeps running). "wake": arm auto-resume if still running.',
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, eventCtx) {
			ctx.ui ??= eventCtx.ui;
			const { session_id: sid, on_exit: policy } = params as { session_id: number; on_exit: OnExitPolicy };
			const session = ctx.store.get(sid);
			if (policy === "wake" && !session) {
				return {
					content: [{ type: "text", text: `No such session: ${sid}` }],
					details: { session_id: sid, found: false },
				};
			}
			const status = ctx.coordinator.setOnExit(sid, policy, session);
			// unknown id: no store session and nothing to disarm
			if (!session && status === "already_none") {
				return {
					content: [{ type: "text", text: `No such session: ${sid}` }],
					details: { session_id: sid, found: false },
				};
			}
			const running = session ? !session.hasExited : false;
			const armed = ctx.coordinator.isArmed(sid);
			const text =
				`set_on_exit session_id=${sid} on_exit=${policy} → ${status}` +
				(session ? (running ? " (process still running)" : " (process already exited)") : " (no store session; coordinator only)") +
				(armed ? "; wake armed" : "; wake not armed");
			return {
				content: [{ type: "text", text }],
				details: {
					session_id: sid,
					found: true,
					on_exit: policy,
					status,
					running,
					wake_armed: armed,
					command: session?.displayCommand,
					log_path: session?.logPath,
					tool_time_utc: nowUtcIso(),
				},
			};
		},
		renderCall: renderSetOnExitCall as any,
		renderResult: renderResult as any,
	});

	pi.registerTool({
		name: "kill_session",
		label: "kill_session",
		description:
			"Terminate a session (SIGTERM, escalates to SIGKILL after 2s; on Windows any signal force-kills the process tree). Use when the process won't exit via Ctrl-C. session_id is invalid after. Also suppresses any armed on_exit wake.",
		promptSnippet: "Terminate a session",
		parameters: Type.Object({
			session_id: Type.Number({ description: "Session to terminate." }),
			signal: Type.Optional(
				Type.String({ description: 'Initial signal (default "SIGTERM"). Examples: SIGINT, SIGHUP, SIGKILL.' }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, eventCtx) {
			ctx.ui ??= eventCtx.ui;
			const sid = (params as { session_id: number; signal?: string }).session_id;
			const initial = normalizeSignal((params as { signal?: string }).signal);
			const outcome = await terminateSessionById(ctx, sid, initial);
			if (!outcome) {
				return {
					content: [{ type: "text", text: `No such session: ${sid}` }],
					details: { session_id: sid, found: false },
				};
			}
			const { session, escalated, finalOutput: text, killed } = outcome;
			updateRunningSessionsUi(ctx);
			const details = {
				session_id: sid,
				final_output: text,
				exit_code: session.exitCode,
				signal: session.signal,
				escalated,
				killed,
				log_path: session.logPath,
			};
			if (!killed) {
				// The kill did NOT land — do not pretend it did. The session
				// stays in the store so it can be retried or inspected.
				return {
					content: [
						{
							type: "text",
							text:
								`FAILED to terminate session ${sid} (pid ${session.pid ?? "?"}): process still running after ${initial}` +
								(escalated ? " and SIGKILL escalation" : "") +
								`. The session remains registered — retry kill_session, or check permissions.` +
								(session.logPath ? `\nlog_path: ${session.logPath}` : ""),
						},
					],
					details,
				};
			}
			const summary =
				`Killed session ${sid} (pid ${session.pid ?? "?"}) with ${initial}` +
				(escalated ? " — escalated to SIGKILL" : "") +
				(session.exitCode !== null ? ` — exit_code=${session.exitCode}` : session.signal ? ` — signal=${session.signal}` : "");
			const logLine = session.logPath ? `\nlog_path: ${session.logPath}` : "";
			return {
				content: [{ type: "text", text: `${summary}${logLine}\n---\n${text || "(no output)"}` }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "list_sessions",
		label: "list_sessions",
		description: "List all live unified-exec sessions in this pi run.",
		promptSnippet: "List live sessions",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, eventCtx) {
			ctx.ui ??= eventCtx.ui;
			// Reap any sessions that have exited silently (e.g., completed between
			// tool calls without anyone observing them) — but report each of them
			// one final time with exit info instead of dropping them on the floor.
			// This mirrors codex's `refresh_process_state` filter while preserving
			// our "exit information is never silently lost" guarantee.
			const reaped: ExecSession[] = [];
			for (const s of ctx.store.values()) {
				if (s.hasExited) {
					// Reporting terminal completion here counts as direct observation:
					// suppress a not-yet-queued wake (an already-queued wake stays a
					// single notification — never a second one).
					ctx.coordinator.observeViaListing(s.id);
					removeSession(ctx, s.id);
					reaped.push(s);
				}
			}
			updateRunningSessionsUi(ctx);
			const now = Date.now();
			const live = ctx.store.values();
			const sessions = [...live, ...reaped]
				.sort((a, b) => a.id - b.id)
				.map((s) => ({
					session_id: s.id,
					command: s.displayCommand,
					cwd: s.cwd,
					tty: s.tty,
					pid: s.pid,
					started_at_ms: s.startedAt,
					elapsed_ms: now - s.startedAt,
					running: !s.hasExited,
					wake_armed: ctx.coordinator.isArmed(s.id),
					exit_code: s.hasExited ? s.exitCode : undefined,
					signal: s.hasExited ? (s.signal ?? undefined) : undefined,
					failure_message: s.failureMessage ?? undefined,
					output_bytes_total: s.totalBytesSeen,
					log_path: s.logPath,
				}));
			const lines = sessions.length
				? sessions.map((s) => {
						const exitedSuffix = s.running
							? ""
							: `  [exited${s.exit_code !== undefined && s.exit_code !== null ? ` exit_code=${s.exit_code}` : ""}${s.signal ? ` signal=${s.signal}` : ""}; removed from store]`;
						const wake = s.wake_armed ? " wake" : "";
						return `  ${String(s.session_id).padStart(3)}  pid=${String(s.pid ?? "?").padStart(6)}  ${
							s.tty ? "tty" : "pipe"
						}  ${((s.elapsed_ms / 1000).toFixed(1) + "s").padStart(8)}${wake}  ${s.command.length > 60 ? s.command.slice(0, 60) + "…" : s.command}${exitedSuffix}\n        log: ${s.log_path}`;
					})
				: ["  (no live sessions)"];
			const header = reaped.length
				? `unified-exec sessions (${live.length} live, ${reaped.length} just exited):`
				: `unified-exec sessions (${live.length}):`;
			return {
				content: [{ type: "text", text: `${header}\n${lines.join("\n")}` }],
				details: { sessions, active_count: live.length },
			};
		},
	});
}
