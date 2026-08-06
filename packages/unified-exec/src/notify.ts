/**
 * A one-shot-per-wait async gate, equivalent to Tokio's `Notify`.
 *
 * A notification without a waiter is lost. One notification wakes every
 * waiter created before it. Cancellable waits let deadline races release
 * parked closures immediately instead of retaining them until later output.
 */

export type NotificationWait = Readonly<{
  promise: Promise<void>;
  cancel: () => void;
}>;

export class Notify {
  private readonly waiters = new Set<() => void>();

  /** Returns a Promise that resolves on the next `notifyAll()` call. */
  notified(): Promise<void> {
    return this.wait().promise;
  }

  /** Returns a cancellable wait. Cancellation also resolves the promise. */
  wait(): NotificationWait {
    let settled = false;
    let resolvePromise: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const settle = (): void => {
      if (settled) return;
      settled = true;
      this.waiters.delete(settle);
      resolvePromise();
    };
    this.waiters.add(settle);
    return { promise, cancel: settle };
  }

  /** Wake every waiter that was created before this call. */
  notifyAll(): void {
    if (this.waiters.size === 0) return;
    const toWake = [...this.waiters];
    for (const settle of toWake) settle();
  }

  /** Number of waiters currently parked (test helper). */
  get waiterCount(): number {
    return this.waiters.size;
  }
}

/** A sticky boolean gate. Once closed, all current and future waits resolve. */
export class Gate {
  private state = false;
  private waiters: Array<() => void> = [];

  get isClosed(): boolean {
    return this.state;
  }

  close(): void {
    if (this.state) return;
    this.state = true;
    const toWake = this.waiters;
    this.waiters = [];
    for (const resolve of toWake) resolve();
  }

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
