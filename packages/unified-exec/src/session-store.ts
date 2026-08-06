/**
 * Bounded registry of sessions with monotonic IDs and LRU eviction.
 *
 * Mirrors codex's `ProcessStore` + `prune_processes_if_needed`:
 *   - Caps at `maxSessions` entries.
 *   - When inserting would exceed the cap, prune the LRU entry that is NOT in
 *     the N-most-recent "protected" set. Prefer already-exited entries first.
 *   - IDs are monotonic and never reused.
 *
 * The store does NOT own process lifetime beyond terminate-on-evict and
 * terminate-all-on-shutdown. The ExecSession itself drives its child.
 */

import type { ExecSession } from "./session.ts";

export interface StoredSession {
  id: number;
  lastUsed: number;
  hasExited: boolean;
  terminate(signal?: NodeJS.Signals): void;
}

export interface SessionStoreOptions<TSession extends StoredSession> {
  maxSessions: number;
  lruProtectedCount: number;
  onEvict?: (session: TSession, reason: "lru" | "shutdown") => void;
}

export class SessionStore<TSession extends StoredSession = ExecSession> {
  private readonly sessions = new Map<number, TSession>();
  private nextId = 1;
  readonly maxSessions: number;
  readonly lruProtectedCount: number;
  private readonly onEvict: SessionStoreOptions<TSession>["onEvict"];

  constructor(options: SessionStoreOptions<TSession>) {
    this.maxSessions = options.maxSessions;
    this.lruProtectedCount = options.lruProtectedCount;
    this.onEvict = options.onEvict;
  }

  allocateId(): number {
    return this.nextId++;
  }

  get(id: number): TSession | undefined {
    return this.sessions.get(id);
  }

  values(): TSession[] {
    return Array.from(this.sessions.values());
  }

  get size(): number {
    return this.sessions.size;
  }

  insert(session: TSession): { pruned?: TSession; count: number } {
    const pruned =
      this.sessions.size >= this.maxSessions ? (this.pruneLru() ?? undefined) : undefined;
    this.sessions.set(session.id, session);
    return {
      ...(pruned === undefined ? {} : { pruned }),
      count: this.sessions.size,
    };
  }

  remove(id: number): TSession | undefined {
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    this.sessions.delete(id);
    return entry;
  }

  terminateAll(): TSession[] {
    const drained = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of drained) {
      try {
        session.terminate();
      } catch {
        // Best effort during shutdown.
      }
      this.onEvict?.(session, "shutdown");
    }
    return drained;
  }

  private pruneLru(): TSession | null {
    const entries = Array.from(this.sessions.values());
    if (entries.length === 0) return null;

    // One ascending sort: the last entries are the protected (most recent) set.
    const byRecencyAsc = [...entries].sort((left, right) => left.lastUsed - right.lastUsed);
    const protectedIds = new Set<number>(
      this.lruProtectedCount > 0
        ? byRecencyAsc.slice(-this.lruProtectedCount).map((entry) => entry.id)
        : [],
    );

    // Prefer oldest exited entries first.
    const exitedCandidate = byRecencyAsc.find(
      (entry) => !protectedIds.has(entry.id) && entry.hasExited,
    );
    const victim = exitedCandidate ?? byRecencyAsc.find((entry) => !protectedIds.has(entry.id));
    if (!victim) return null;

    this.sessions.delete(victim.id);
    try {
      victim.terminate();
    } catch {
      // Best effort at the eviction boundary.
    }
    this.onEvict?.(victim, "lru");
    return victim;
  }
}
