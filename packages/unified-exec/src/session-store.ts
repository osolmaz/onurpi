/**
 * Bounded registry of sessions with monotonic IDs and LRU eviction.
 *
 * The store does not own normal process lifetime. It only terminates sessions
 * evicted at the cap or drained during shutdown.
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
  private readonly reservedIds = new Set<number>();
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
    const id = this.nextId++;
    this.reservedIds.add(id);
    return id;
  }

  releaseId(id: number): void {
    this.reservedIds.delete(id);
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
    this.reservedIds.delete(session.id);
    return {
      ...(pruned === undefined ? {} : { pruned }),
      count: this.sessions.size,
    };
  }

  remove(id: number): TSession | undefined {
    this.reservedIds.delete(id);
    const entry = this.sessions.get(id);
    if (!entry) return undefined;
    this.sessions.delete(id);
    return entry;
  }

  terminateAll(): TSession[] {
    const drained = Array.from(this.sessions.values());
    this.sessions.clear();
    this.reservedIds.clear();
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
    const byNewest = [...entries].sort((left, right) => right.lastUsed - left.lastUsed);
    const protectedIds = new Set(
      byNewest.slice(0, this.lruProtectedCount).map((entry) => entry.id),
    );
    const byOldest = [...entries].sort((left, right) => left.lastUsed - right.lastUsed);
    const victim =
      byOldest.find((entry) => !protectedIds.has(entry.id) && entry.hasExited) ??
      byOldest.find((entry) => !protectedIds.has(entry.id));
    if (!victim) return null;
    this.sessions.delete(victim.id);
    this.reservedIds.delete(victim.id);
    try {
      victim.terminate();
    } catch {
      // Best effort at the eviction boundary.
    }
    this.onEvict?.(victim, "lru");
    return victim;
  }
}
