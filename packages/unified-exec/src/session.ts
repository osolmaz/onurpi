/**
 * ExecSession — wraps a SpawnedChild with:
 *   - a head+tail output buffer (drained by polls)
 *   - a rolling tail window (for TUI streaming via onUpdate)
 *   - state transitions (has_exited / exit_code / signal / failure)
 *   - lifecycle callbacks (onData taps, onExit fan-out)
 *
 * Mirrors codex's `UnifiedExecProcess` in `unified_exec/process.rs`, simplified
 * to the subset we need for the pi extension.
 */

import { randomBytes } from "node:crypto";
import { closeSync, createWriteStream, openSync, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HeadTailBuffer } from "./head-tail-buffer.ts";
import { Gate, Notify } from "./notify.ts";
import { type SpawnedChild, spawnChild } from "./pty.ts";

/** Default per-session output retention. */
export const DEFAULT_HEAD_TAIL_MAX_BYTES = 1024 * 1024; // 1 MiB

/** Default rolling tail window used for TUI streaming (independent of the head+tail buffer). */
export const DEFAULT_STREAM_TAIL_BYTES = 32 * 1024; // 32 KiB

export interface SessionSpawnOptions {
	command: string[];
	cwd: string;
	env: NodeJS.ProcessEnv;
	tty: boolean;
	cols?: number;
	rows?: number;
	headTailMaxBytes?: number;
	streamTailBytes?: number;
	displayCommand?: string; // human-readable command for list_sessions/UI
	shell?: string; // raw `shell` arg recorded for introspection
	windowsVerbatimArguments?: boolean; // Windows cmd.exe quoting (see shell.ts)
}

export interface SessionState {
	hasExited: boolean;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	failureMessage: string | null;
}

export class ExecSession {
	readonly id: number;
	readonly tty: boolean;
	readonly command: string[];
	readonly displayCommand: string;
	readonly cwd: string;
	readonly startedAt: number;
	readonly pid: number | undefined;
	/** Path to a log file that receives the full stdout+stderr stream. */
	readonly logPath: string;
	private logStream: WriteStream | undefined;

	/** Head+tail buffer drained by each collectOutputUntilDeadline() call. */
	readonly outputBuffer: HeadTailBuffer;
	/** Fired whenever new data arrives in outputBuffer. */
	readonly outputNotify = new Notify();
	/** Closed when the stream is done (all data flushed after exit). */
	readonly outputClosed = new Gate();
	/** Aborts when the process has exited (may still have trailing output). */
	private readonly exitedAc = new AbortController();
	get exited(): AbortSignal {
		return this.exitedAc.signal;
	}

	/** Running tail window for TUI streaming; independent of outputBuffer. */
	private streamTail: Uint8Array[] = [];
	private streamTailBytes = 0;
	private readonly streamTailCap: number;
	private totalOutputBytes = 0;

	private state: SessionState = {
		hasExited: false,
		exitCode: null,
		signal: null,
		failureMessage: null,
	};
	private readonly exitListeners = new Set<(session: ExecSession) => void>();
	private lastUsedAt: number;
	private child!: SpawnedChild;

	private constructor(id: number, opts: SessionSpawnOptions) {
		this.id = id;
		this.command = opts.command;
		this.displayCommand = opts.displayCommand ?? opts.command.join(" ");
		this.cwd = opts.cwd;
		this.tty = opts.tty;
		this.startedAt = Date.now();
		this.lastUsedAt = this.startedAt;
		this.outputBuffer = new HeadTailBuffer(opts.headTailMaxBytes ?? DEFAULT_HEAD_TAIL_MAX_BYTES);
		this.streamTailCap = opts.streamTailBytes ?? DEFAULT_STREAM_TAIL_BYTES;
		this.pid = undefined; // set in `start`
		this.logPath = join(tmpdir(), `pi-unified-exec-${id}-${randomBytes(4).toString("hex")}.log`);
	}

	static spawn(id: number, opts: SessionSpawnOptions): ExecSession {
		const self = new ExecSession(id, opts);

		// Touch-create the file synchronously so it exists on disk from t=0
		// even before the child writes anything (and before the lazy stream
		// opens the fd on its first buffered write). Then open a stream in
		// append mode for the actual writes.
		try {
			closeSync(openSync(self.logPath, "w"));
			self.logStream = createWriteStream(self.logPath, { flags: "a" });
			self.logStream.on("error", (err) => {
				// Log-stream error (disk full, permissions, etc.). The child is
				// still running: record the failure and stop mirroring writes, but
				// do NOT mark the session exited — that would make it unkillable
				// (kill() no-ops once hasExited) and orphan the process.
				self.recordFailure(`log stream error: ${err?.message ?? err}`);
				self.logStream = undefined;
			});
		} catch (err: any) {
			self.markFailure(`failed to open log file ${self.logPath}: ${err?.message ?? err}`);
			self.exitedAc.abort();
			self.outputClosed.close();
			return self;
		}

		try {
			self.child = spawnChild({
				command: opts.command,
				cwd: opts.cwd,
				env: opts.env,
				tty: opts.tty,
				cols: opts.cols,
				rows: opts.rows,
				windowsVerbatimArguments: opts.windowsVerbatimArguments,
			});
		} catch (err: any) {
			self.markFailure(err?.message ?? String(err));
			self.logStream?.end();
			self.logStream = undefined;
			self.exitedAc.abort();
			self.outputClosed.close();
			return self;
		}

		// child's actual pid
		Object.defineProperty(self, "pid", { value: self.child.pid, enumerable: true });

		self.child.onData((chunk) => {
			self.totalOutputBytes += chunk.length;
			self.outputBuffer.pushChunk(chunk);
			self.appendStreamTail(chunk);
			// Mirror every byte to the log file. Errors are handled by the
			// 'error' listener on the stream, which nulls `logStream` out.
			self.logStream?.write(Buffer.from(chunk));
			self.outputNotify.notifyAll();
		});

		self.child.onExit((exitCode, signal, failureMessage) => {
			self.state = {
				hasExited: true,
				exitCode,
				signal,
				failureMessage: self.state.failureMessage ?? failureMessage ?? null,
			};
			self.exitedAc.abort();
			self.notifyExitListeners();
			// Fire a notify so any parked waiters wake up and see the exit.
			self.outputNotify.notifyAll();
			// A short tick later, flush the log stream to disk, then close the
			// output gate. The tick lets any pending data-handler chunks land
			// in the buffer+log before we declare the session fully done.
			setImmediate(() => {
				self.outputNotify.notifyAll();
				const stream = self.logStream;
				self.logStream = undefined;
				if (!stream) {
					self.outputClosed.close();
					self.outputNotify.notifyAll();
					return;
				}
				const finalize = () => {
					self.outputClosed.close();
					self.outputNotify.notifyAll();
				};
				// Wait for the stream to finish flushing before declaring
				// `outputClosed` so consumers that await the drain see a
				// fully-flushed log file on disk.
				stream.once("close", finalize);
				stream.end();
			});
		});

		return self;
	}

	private appendStreamTail(chunk: Uint8Array): void {
		this.streamTail.push(chunk);
		this.streamTailBytes += chunk.length;
		while (this.streamTailBytes > this.streamTailCap && this.streamTail.length > 1) {
			const front = this.streamTail[0]!;
			if (this.streamTailBytes - front.length >= this.streamTailCap) {
				this.streamTail.shift();
				this.streamTailBytes -= front.length;
			} else {
				// Trim the front of the leading chunk just enough.
				const drop = this.streamTailBytes - this.streamTailCap;
				this.streamTail[0] = front.subarray(drop);
				this.streamTailBytes -= drop;
				break;
			}
		}
	}

	/**
	 * Record a non-fatal failure (e.g. log mirroring broke) WITHOUT marking the
	 * session exited. The child keeps running and stays controllable.
	 */
	private recordFailure(message: string): void {
		this.state = {
			...this.state,
			failureMessage: this.state.failureMessage ?? message,
		};
	}

	/** Mark the session as failed-and-exited. Only for spawn-time failures. */
	private markFailure(message: string): void {
		this.state = {
			hasExited: true,
			exitCode: this.state.exitCode,
			signal: this.state.signal,
			failureMessage: message,
		};
		this.notifyExitListeners();
	}

	private notifyExitListeners(): void {
		for (const listener of this.exitListeners) {
			try {
				listener(this);
			} catch {
				// ignore listener failures
			}
		}
	}

	/** Register a listener fired when this session exits. */
	onExit(listener: (session: ExecSession) => void): () => void {
		this.exitListeners.add(listener);
		if (this.hasExited) {
			queueMicrotask(() => {
				if (this.exitListeners.has(listener)) listener(this);
			});
		}
		return () => this.exitListeners.delete(listener);
	}

	/** Snapshot the current rolling tail (for streaming updates). */
	snapshotStreamTail(): Uint8Array {
		let total = 0;
		for (const c of this.streamTail) total += c.length;
		const out = new Uint8Array(total);
		let offset = 0;
		for (const c of this.streamTail) {
			out.set(c, offset);
			offset += c.length;
		}
		return out;
	}

	/** Write bytes to stdin. Returns true on success, false if closed/dead. */
	write(data: Uint8Array): boolean {
		if (this.state.hasExited) return false;
		return this.child.write(data);
	}

	/** Send a signal. No-op if already exited. */
	kill(signal: NodeJS.Signals = "SIGTERM"): void {
		if (this.state.hasExited) return;
		this.child.kill(signal);
	}

	/** Snapshot the current state. */
	snapshotState(): SessionState {
		return { ...this.state };
	}

	get hasExited(): boolean {
		return this.state.hasExited;
	}

	get exitCode(): number | null {
		return this.state.exitCode;
	}

	get signal(): NodeJS.Signals | null {
		return this.state.signal;
	}

	get failureMessage(): string | null {
		return this.state.failureMessage;
	}

	get totalBytesSeen(): number {
		return this.totalOutputBytes;
	}

	get lastUsed(): number {
		return this.lastUsedAt;
	}

	touch(): void {
		this.lastUsedAt = Date.now();
	}

	/** Terminate + mark closed. Used by session-store LRU eviction / shutdown. */
	terminate(signal: NodeJS.Signals = "SIGTERM"): void {
		this.kill(signal);
		// onExit closes logStream; terminate() is idempotent so this is fine.
	}
}
