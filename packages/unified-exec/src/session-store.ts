/**
 * SessionStore — keyed registry of ExecSession instances with LRU eviction.
 *
 * Mirrors codex's `ProcessStore` + `prune_processes_if_needed`:
 *   - Caps at `maxSessions` entries.
 *   - When inserting would exceed the cap, prune the LRU entry that is NOT in
 *     the N-most-recent "protected" set. Prefer already-exited entries first.
 *   - Reserved IDs (allocated but not yet inserted) block re-allocation.
 *
 * The store does NOT own process lifetime beyond terminate-on-evict and
 * terminate-all-on-shutdown. The ExecSession itself drives its child.
 */

import { ExecSession } from "./session.ts";

export interface SessionStoreOptions {
	maxSessions: number;
	lruProtectedCount: number;
	/** Called when a session is evicted (for UI cleanup). */
	onEvict?: (session: ExecSession, reason: "lru" | "shutdown") => void;
}

export class SessionStore {
	private readonly sessions = new Map<number, ExecSession>();
	private readonly reservedIds = new Set<number>();
	private nextId = 1;
	readonly maxSessions: number;
	readonly lruProtectedCount: number;
	private readonly onEvict: SessionStoreOptions["onEvict"];

	constructor(opts: SessionStoreOptions) {
		this.maxSessions = opts.maxSessions;
		this.lruProtectedCount = opts.lruProtectedCount;
		this.onEvict = opts.onEvict;
	}

	/** Allocate a new monotonic session id and reserve it. */
	allocateId(): number {
		const id = this.nextId++;
		this.reservedIds.add(id);
		return id;
	}

	/** Release a reserved id that won't be used (allocation failed). */
	releaseId(id: number): void {
		this.reservedIds.delete(id);
	}

	get(id: number): ExecSession | undefined {
		return this.sessions.get(id);
	}

	values(): ExecSession[] {
		return Array.from(this.sessions.values());
	}

	get size(): number {
		return this.sessions.size;
	}

	/**
	 * Insert a session. Returns the evicted session, if any. If inserting the
	 * new session would exceed the cap, prune an LRU non-protected entry first.
	 */
	insert(session: ExecSession): { pruned?: ExecSession; count: number } {
		let pruned: ExecSession | undefined;
		if (this.sessions.size >= this.maxSessions) {
			pruned = this.pruneLru() ?? undefined;
		}
		this.sessions.set(session.id, session);
		this.reservedIds.delete(session.id);
		return { pruned, count: this.sessions.size };
	}

	/** Remove a session (e.g., when it exits). */
	remove(id: number): ExecSession | undefined {
		this.reservedIds.delete(id);
		const entry = this.sessions.get(id);
		if (!entry) return undefined;
		this.sessions.delete(id);
		return entry;
	}

	/** Terminate all sessions and clear the store. Used on session_shutdown. */
	terminateAll(): ExecSession[] {
		const drained = Array.from(this.sessions.values());
		this.sessions.clear();
		this.reservedIds.clear();
		for (const s of drained) {
			try {
				s.terminate();
			} catch {
				// ignore
			}
			this.onEvict?.(s, "shutdown");
		}
		return drained;
	}

	/**
	 * LRU eviction policy (matches codex's `process_id_to_prune_from_meta`):
	 *   1. Protect the N most-recently-used entries.
	 *   2. Among unprotected: prefer already-exited entries (oldest first).
	 *   3. Otherwise: oldest unprotected entry, alive or not.
	 */
	private pruneLru(): ExecSession | null {
		const entries = Array.from(this.sessions.values());
		if (entries.length === 0) return null;

		const byRecencyDesc = [...entries].sort((a, b) => b.lastUsed - a.lastUsed);
		const protectedIds = new Set<number>(byRecencyDesc.slice(0, this.lruProtectedCount).map((e) => e.id));

		const byRecencyAsc = [...entries].sort((a, b) => a.lastUsed - b.lastUsed);

		// Prefer oldest exited entries first.
		const exitedCandidate = byRecencyAsc.find((e) => !protectedIds.has(e.id) && e.hasExited);
		const victim = exitedCandidate ?? byRecencyAsc.find((e) => !protectedIds.has(e.id));
		if (!victim) return null;

		this.sessions.delete(victim.id);
		this.reservedIds.delete(victim.id);
		try {
			victim.terminate();
		} catch {
			// ignore
		}
		this.onEvict?.(victim, "lru");
		return victim;
	}
}
