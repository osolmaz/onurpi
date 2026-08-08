import { AgentSession, VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateRetryDelayMs,
  hideInfiniteRetryDenominator,
  installInfiniteRetryIndicatorPatch,
  installInfiniteRetryPatch,
  loadPiRetryStatusIndicatorPrototype,
  MAX_RETRY_DELAY_MS,
  MINIMUM_PI_VERSION,
  type InfiniteRetryPatchLease,
  type RetryIndicatorPatchLease,
  type RetryStatus,
} from "./infinite-retry.ts";
import { formatRetryStatusLabel } from "./index.ts";

type RetrySettings = { enabled: boolean; maxRetries: number; baseDelayMs: number };

type FakeAssistant = {
  role: "assistant";
  stopReason: "error" | "stop";
  errorMessage?: string;
  retryable?: boolean;
};

class FakeRetryIndicatorBase {
  text: unknown;

  setText(text: unknown): void {
    this.text = text;
  }
}

class FakeRetryIndicator extends FakeRetryIndicatorBase {}

class FakeAgentSession {
  readonly agent = { state: { messages: [] as unknown[] } };
  readonly events: Record<string, unknown>[] = [];
  readonly settings: RetrySettings = { enabled: true, maxRetries: 3, baseDelayMs: 2_000 };
  readonly settingsManager = { getRetrySettings: () => this.settings };
  _retryAbortController: AbortController | undefined;
  _retryAttempt = 0;

  _emit(event: Record<string, unknown>): void {
    this.events.push(event);
  }

  _isRetryableError(message: unknown): boolean {
    return isRecord(message) && message["retryable"] === true;
  }

  _prepareRetry(message: unknown): Promise<boolean> {
    void message;
    return Promise.resolve(false);
  }

  _willRetryAfterAgentEnd(event: unknown): boolean {
    void event;
    return false;
  }

  abortRetry(): void {
    this._retryAbortController?.abort();
  }
}

const leases: InfiniteRetryPatchLease[] = [];
const indicatorLeases: RetryIndicatorPatchLease[] = [];

afterEach(() => {
  for (const lease of leases.splice(0).reverse()) lease.release();
  for (const lease of indicatorLeases.splice(0).reverse()) lease.release();
  vi.useRealTimers();
});

function install(maxDelayMs = MAX_RETRY_DELAY_MS): InfiniteRetryPatchLease {
  const lease = installInfiniteRetryPatch({
    maxDelayMs,
    prototype: FakeAgentSession.prototype,
    runtimeVersion: MINIMUM_PI_VERSION,
  });
  leases.push(lease);
  return lease;
}

function installIndicator(
  prototype: object = FakeRetryIndicator.prototype,
): RetryIndicatorPatchLease {
  const lease = installInfiniteRetryIndicatorPatch({
    prototype,
    runtimeVersion: MINIMUM_PI_VERSION,
  });
  indicatorLeases.push(lease);
  return lease;
}

function error(message = "Codex error: You can retry your request"): FakeAssistant {
  return { role: "assistant", stopReason: "error", errorMessage: message, retryable: true };
}

function oneArgumentMethod(value: unknown): boolean {
  return value !== undefined;
}

function zeroArgumentMethod(): void {
  return undefined;
}

describe("calculateRetryDelayMs", () => {
  it("doubles delays and saturates at ten minutes without overflowing", () => {
    expect(calculateRetryDelayMs(2_000, 1, MAX_RETRY_DELAY_MS)).toBe(2_000);
    expect(calculateRetryDelayMs(2_000, 9, MAX_RETRY_DELAY_MS)).toBe(512_000);
    expect(calculateRetryDelayMs(2_000, 10, MAX_RETRY_DELAY_MS)).toBe(MAX_RETRY_DELAY_MS);
    expect(calculateRetryDelayMs(2_000, Number.MAX_SAFE_INTEGER, MAX_RETRY_DELAY_MS)).toBe(
      MAX_RETRY_DELAY_MS,
    );
  });

  it("supports zero delays and validates all inputs", () => {
    expect(calculateRetryDelayMs(0, 1, MAX_RETRY_DELAY_MS)).toBe(0);
    expect(calculateRetryDelayMs(2_000, 1, 0)).toBe(0);
    expect(calculateRetryDelayMs(MAX_RETRY_DELAY_MS + 1, 1, MAX_RETRY_DELAY_MS)).toBe(
      MAX_RETRY_DELAY_MS,
    );
    expect(() => calculateRetryDelayMs(-1, 1, MAX_RETRY_DELAY_MS)).toThrow("retry base delay");
    expect(() => calculateRetryDelayMs(1, 0, MAX_RETRY_DELAY_MS)).toThrow("retry attempt");
    expect(() => calculateRetryDelayMs(1, 1, Number.POSITIVE_INFINITY)).toThrow("retry delay cap");
  });
});

describe("infinite retry indicator", () => {
  it("removes only the infinite retry denominator", () => {
    const infinite = `Retrying (2/${String(Number.MAX_SAFE_INTEGER)}) in 4s...`;
    expect(hideInfiniteRetryDenominator(infinite)).toBe("Retrying (2) in 4s...");
    expect(hideInfiniteRetryDenominator("Retrying (2/3) in 4s...")).toBe("Retrying (2/3) in 4s...");
    expect(
      formatRetryStatusLabel({ state: "waiting", attempt: 2, delayMs: 4_000, dueAt: 5_000 }, 1_000),
    ).toBe("retry 2 in 4s · Alt+R now");
  });

  it("patches inherited setText calls and restores the prototype", () => {
    const original: unknown = Reflect.get(FakeRetryIndicator.prototype, "setText");
    expect(Object.hasOwn(FakeRetryIndicator.prototype, "setText")).toBe(false);
    const lease = installIndicator();
    const indicator = new FakeRetryIndicator();

    indicator.setText(`Retrying (7/${String(Number.MAX_SAFE_INTEGER)}) in 10m...`);
    expect(indicator.text).toBe("Retrying (7) in 10m...");
    callSetText(indicator, 42);
    expect(indicator.text).toBe(42);

    lease.release();
    expect(Object.hasOwn(FakeRetryIndicator.prototype, "setText")).toBe(false);
    expect(Reflect.get(FakeRetryIndicator.prototype, "setText")).toBe(original);

    const ownDescriptor = Object.getOwnPropertyDescriptor(
      FakeRetryIndicatorBase.prototype,
      "setText",
    );
    const ownLease = installIndicator(FakeRetryIndicatorBase.prototype);
    ownLease.release();
    expect(Object.getOwnPropertyDescriptor(FakeRetryIndicatorBase.prototype, "setText")).toEqual(
      ownDescriptor,
    );
  });

  it("shares one wrapper and rejects conflicting or locked prototypes", () => {
    const first = installIndicator();
    const patched: unknown = Reflect.get(FakeRetryIndicator.prototype, "setText");
    const second = installIndicator();
    expect(Reflect.get(FakeRetryIndicator.prototype, "setText")).toBe(patched);

    class OtherRetryIndicator extends FakeRetryIndicatorBase {}
    expect(() => installIndicator(OtherRetryIndicator.prototype)).toThrow(
      "already installed on a different RetryStatusIndicator prototype",
    );

    first.release();
    expect(Reflect.get(FakeRetryIndicator.prototype, "setText")).toBe(patched);
    second.release();
    expect(Object.hasOwn(FakeRetryIndicator.prototype, "setText")).toBe(false);

    class LockedRetryIndicator extends FakeRetryIndicatorBase {}
    Object.preventExtensions(LockedRetryIndicator.prototype);
    expect(() => installIndicator(LockedRetryIndicator.prototype)).toThrow(
      "setText() is not patchable",
    );
  });

  it("loads, patches, and restores the current Pi retry indicator", async () => {
    const prototype = await loadPiRetryStatusIndicatorPrototype();
    const original: unknown = Reflect.get(prototype, "setText");
    const hadOwnMethod = Object.hasOwn(prototype, "setText");
    const lease = installIndicator(prototype);

    expect(Reflect.get(prototype, "setText")).not.toBe(original);
    lease.release();
    expect(Object.hasOwn(prototype, "setText")).toBe(hadOwnMethod);
    expect(Reflect.get(prototype, "setText")).toBe(original);
  });
});

describe("installInfiniteRetryPatch", () => {
  it("patches and restores the current development Pi runtime", () => {
    expect(VERSION).toBe("0.84.1");
    const original = methodValue(AgentSession.prototype, "_prepareRetry");
    const lease = installInfiniteRetryPatch();
    leases.push(lease);

    expect(methodValue(AgentSession.prototype, "_prepareRetry")).not.toBe(original);
    lease.release();
    expect(methodValue(AgentSession.prototype, "_prepareRetry")).toBe(original);
  });

  it("accepts current and future Pi versions when the private retry shape matches", () => {
    for (const runtimeVersion of [MINIMUM_PI_VERSION, "0.83.0", "0.84.0-next.1", "1.0.0"]) {
      const lease = installInfiniteRetryPatch({
        prototype: FakeAgentSession.prototype,
        runtimeVersion,
      });
      lease.release();
    }
  });

  it("rejects old, malformed, or incompatible private retry contracts", () => {
    for (const runtimeVersion of ["0.82.0", "next", "999999999999999999999.0.0"]) {
      expect(() =>
        installInfiniteRetryPatch({
          prototype: FakeAgentSession.prototype,
          runtimeVersion,
        }),
      ).toThrow(`requires Pi ${MINIMUM_PI_VERSION} or newer`);
    }
    expect(() =>
      installInfiniteRetryPatch({ prototype: {}, runtimeVersion: MINIMUM_PI_VERSION }),
    ).toThrow("expected _prepareRetry() with 1 parameter(s)");

    const lockedPrototype = {
      _isRetryableError: oneArgumentMethod,
      abortRetry: zeroArgumentMethod,
    };
    Object.defineProperty(lockedPrototype, "_prepareRetry", {
      value: oneArgumentMethod,
    });
    Object.defineProperty(lockedPrototype, "_willRetryAfterAgentEnd", {
      value: oneArgumentMethod,
    });
    expect(() =>
      installInfiniteRetryPatch({
        prototype: lockedPrototype,
        runtimeVersion: MINIMUM_PI_VERSION,
      }),
    ).toThrow("is not patchable");

    class MissingClassifier extends FakeAgentSession {}
    Object.defineProperty(MissingClassifier.prototype, "_prepareRetry", {
      configurable: true,
      value: oneArgumentMethod,
      writable: true,
    });
    Object.defineProperty(MissingClassifier.prototype, "_willRetryAfterAgentEnd", {
      configurable: true,
      value: oneArgumentMethod,
      writable: true,
    });
    expect(() =>
      installInfiniteRetryPatch({
        prototype: MissingClassifier.prototype,
        runtimeVersion: "0.83.0",
      }),
    ).toThrow("expected _isRetryableError() with 1 parameter(s)");
  });
});

describe("patched retry behavior", () => {
  it("rejects a second AgentSession prototype while the patch is active", () => {
    install();
    class OtherSession extends FakeAgentSession {}

    expect(() =>
      installInfiniteRetryPatch({
        prototype: OtherSession.prototype,
        runtimeVersion: MINIMUM_PI_VERSION,
      }),
    ).toThrow("already installed on a different AgentSession prototype");
  });

  it("keeps retryable errors eligible after Pi's finite retry budget", () => {
    install();
    const session = new FakeAgentSession();
    session._retryAttempt = session.settings.maxRetries;

    expect(session._willRetryAfterAgentEnd({ messages: [{ role: "user" }, error()] })).toBe(true);
    expect(
      session._willRetryAfterAgentEnd({
        messages: [{ role: "user" }, { ...error(), retryable: false }],
      }),
    ).toBe(false);
    expect(session._willRetryAfterAgentEnd({ messages: [{ role: "user" }] })).toBe(false);

    session.settings.enabled = false;
    expect(session._willRetryAfterAgentEnd({ messages: [error()] })).toBe(false);
  });

  it("wakes a pending retry immediately without cancelling the retry", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    const failed = error();
    session.agent.state.messages = [{ role: "user" }, failed];
    const statuses: RetryStatus[] = [];
    lease.onStatus((status) => statuses.push(status));

    const pending = session._prepareRetry(failed);

    expect(session._retryAttempt).toBe(1);
    expect(session.agent.state.messages).toEqual([{ role: "user" }]);
    expect(lease.getStatus()).toMatchObject({ state: "waiting", attempt: 1, delayMs: 2_000 });
    expect(session.events[0]).toMatchObject({
      type: "auto_retry_start",
      attempt: 1,
      maxAttempts: Number.MAX_SAFE_INTEGER,
      delayMs: 2_000,
    });
    expect(lease.retryNow()).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(lease.retryNow()).toBe(false);
    expect(session._retryAttempt).toBe(1);
    expect(session._retryAbortController).toBeUndefined();
    expect(statuses.at(-1)).toEqual({ state: "idle" });
  });

  it("waits for a capped delay on arbitrarily large attempts", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    const failed = error();
    session._retryAttempt = 1_000_000;
    session.agent.state.messages = [failed];

    const pending = session._prepareRetry(failed);
    expect(lease.getStatus()).toMatchObject({
      state: "waiting",
      attempt: 1_000_001,
      delayMs: MAX_RETRY_DELAY_MS,
    });
    await vi.advanceTimersByTimeAsync(MAX_RETRY_DELAY_MS);
    await expect(pending).resolves.toBe(true);
  });

  it("saturates the reported attempt before integer precision is lost", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    const failed = error();
    session._retryAttempt = Number.MAX_SAFE_INTEGER;
    session.agent.state.messages = [failed];

    const pending = session._prepareRetry(failed);
    expect(lease.getStatus()).toMatchObject({
      state: "waiting",
      attempt: Number.MAX_SAFE_INTEGER,
      delayMs: MAX_RETRY_DELAY_MS,
    });
    expect(lease.retryNow()).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it("preserves Escape cancellation semantics", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    const failed = error();
    session.agent.state.messages = [failed];

    const pending = session._prepareRetry(failed);
    session.abortRetry();

    await expect(pending).resolves.toBe(false);
    expect(session._retryAttempt).toBe(0);
    expect(session.events.at(-1)).toEqual({
      type: "auto_retry_end",
      success: false,
      attempt: 1,
      finalError: "Retry cancelled",
    });
    expect(lease.getStatus()).toEqual({ state: "idle" });
  });

  it("passes through when retry is disabled", async () => {
    const lease = install();
    const session = new FakeAgentSession();
    session.settings.enabled = false;

    await expect(session._prepareRetry(error())).resolves.toBe(false);
    expect(session.events).toEqual([]);
    expect(lease.getStatus()).toEqual({ state: "idle" });
  });

  it("uses a generic error label and keeps a non-assistant trailing message", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    session.agent.state.messages = [{ role: "assistant" }, { role: "toolResult" }];

    const pending = session._prepareRetry({ role: "assistant" });

    expect(session.events[0]?.["errorMessage"]).toBe("Unknown error");
    expect(session.agent.state.messages).toHaveLength(2);
    expect(lease.retryNow()).toBe(true);
    await expect(pending).resolves.toBe(true);
  });

  it("shares one wrapper and restores both original methods after the final release", () => {
    const originalPrepare = methodValue(FakeAgentSession.prototype, "_prepareRetry");
    const originalWillRetry = methodValue(FakeAgentSession.prototype, "_willRetryAfterAgentEnd");
    const first = install();
    const patchedPrepare = methodValue(FakeAgentSession.prototype, "_prepareRetry");
    const second = install();

    expect(patchedPrepare).not.toBe(originalPrepare);
    expect(methodValue(FakeAgentSession.prototype, "_prepareRetry")).toBe(patchedPrepare);
    first.release();
    expect(methodValue(FakeAgentSession.prototype, "_prepareRetry")).toBe(patchedPrepare);
    second.release();
    expect(methodValue(FakeAgentSession.prototype, "_prepareRetry")).toBe(originalPrepare);
    expect(methodValue(FakeAgentSession.prototype, "_willRetryAfterAgentEnd")).toBe(
      originalWillRetry,
    );
  });

  it("cancels an active wait when the final lease is released", async () => {
    vi.useFakeTimers();
    const lease = install();
    const session = new FakeAgentSession();
    const failed = error();
    session.agent.state.messages = [failed];
    const pending = session._prepareRetry(failed);

    lease.release();

    await expect(pending).resolves.toBe(false);
    expect(session._retryAttempt).toBe(0);
  });
});

function callSetText(indicator: object, text: unknown): void {
  const method: unknown = Reflect.get(indicator, "setText");
  if (typeof method !== "function") throw new Error("Missing test setText() method");
  Reflect.apply(method, indicator, [text]);
}

function methodValue(prototype: object, name: string): unknown {
  return Object.getOwnPropertyDescriptor(prototype, name)?.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
