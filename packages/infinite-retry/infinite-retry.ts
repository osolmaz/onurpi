import { AgentSession, VERSION } from "@earendil-works/pi-coding-agent";
import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const MINIMUM_PI_VERSION = "0.82.1";
export const MAX_RETRY_DELAY_MS = 600_000;
const INFINITE_ATTEMPTS = Number.MAX_SAFE_INTEGER;
const INFINITE_ATTEMPT_SUFFIX = `/${String(INFINITE_ATTEMPTS)})`;
const PREPARE_RETRY_METHOD = "_prepareRetry";
const WILL_RETRY_METHOD = "_willRetryAfterAgentEnd";
const RETRY_INDICATOR_SET_TEXT_METHOD = "setText";

export type RetryStatus =
  | { state: "idle" }
  | { state: "waiting"; attempt: number; delayMs: number; dueAt: number };

type RetryReporter = (status: RetryStatus) => void;

type RetryWaitOutcome = "elapsed" | "wake" | "cancel";

type PatchRegistry = {
  prototype: object;
  prepareDescriptor: PropertyDescriptor;
  willRetryDescriptor: PropertyDescriptor;
  leases: number;
  reporters: Set<RetryReporter>;
  status: RetryStatus;
  wait: RetryWait | undefined;
};

type OneArgumentMethod = (this: unknown, argument: unknown) => unknown;

type RetryIndicatorPatchRegistry = {
  prototype: object;
  ownSetTextDescriptor: PropertyDescriptor | undefined;
  originalSetText: OneArgumentMethod;
  patchedSetText: OneArgumentMethod;
  leases: number;
};

declare global {
  // The global registries prevent duplicate prototype wrappers when Pi loads the package twice.
  var onurPiInfiniteRetryPatchV1: PatchRegistry | undefined;
  var onurPiInfiniteRetryIndicatorPatchV1: RetryIndicatorPatchRegistry | undefined;
}

export type InfiniteRetryPatchLease = {
  getStatus(): RetryStatus;
  onStatus(reporter: RetryReporter): () => void;
  release(): void;
  retryNow(): boolean;
};

export type InfiniteRetryPatchOptions = {
  maxDelayMs?: number;
  prototype?: object;
  runtimeVersion?: string;
};

export type RetryIndicatorPatchLease = {
  release(): void;
};

export type RetryIndicatorPatchOptions = {
  prototype: object;
  runtimeVersion?: string;
};

class RetryWait {
  readonly controller = new AbortController();
  readonly delayMs: number;
  readonly dueAt: number;
  readonly result: Promise<RetryWaitOutcome>;
  private finish: ((outcome: RetryWaitOutcome) => void) | undefined;
  private readonly timer: NodeJS.Timeout;

  constructor(delayMs: number) {
    this.delayMs = delayMs;
    this.dueAt = Date.now() + delayMs;
    this.result = new Promise((resolve) => {
      this.finish = resolve;
    });
    this.timer = setTimeout(() => this.settle("elapsed"), delayMs);
    this.controller.signal.addEventListener("abort", this.handleAbort, { once: true });
  }

  cancel(): boolean {
    if (this.finish === undefined) return false;
    this.controller.abort();
    return true;
  }

  wake(): boolean {
    return this.settle("wake");
  }

  private readonly handleAbort = (): void => {
    this.settle("cancel");
  };

  private settle(outcome: RetryWaitOutcome): boolean {
    const finish = this.finish;
    if (finish === undefined) return false;
    this.finish = undefined;
    clearTimeout(this.timer);
    this.controller.signal.removeEventListener("abort", this.handleAbort);
    finish(outcome);
    return true;
  }
}

export function calculateRetryDelayMs(
  baseDelayMs: number,
  attempt: number,
  maxDelayMs: number,
): number {
  assertNonNegativeFinite(baseDelayMs, "retry base delay");
  assertPositiveInteger(attempt, "retry attempt");
  assertNonNegativeFinite(maxDelayMs, "retry delay cap");
  if (baseDelayMs === 0 || maxDelayMs === 0) return 0;
  if (baseDelayMs >= maxDelayMs) return maxDelayMs;

  const exponent = attempt - 1;
  const saturationExponent = Math.ceil(Math.log2(maxDelayMs / baseDelayMs));
  if (exponent >= saturationExponent) return maxDelayMs;
  return Math.min(baseDelayMs * 2 ** exponent, maxDelayMs);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
}

export async function loadPiRetryStatusIndicatorPrototype(): Promise<object> {
  const packageJsonPath = findPackageJSON("@earendil-works/pi-coding-agent", import.meta.url);
  if (packageJsonPath === undefined) {
    throw new Error(`Pi ${VERSION} retry indicator contract mismatch: package not found`);
  }
  const indicatorModuleUrl = pathToFileURL(
    join(dirname(packageJsonPath), "dist/modes/interactive/components/status-indicator.js"),
  );
  const importedModule: unknown = await import(indicatorModuleUrl.href);
  const moduleRecord = requireRecord(
    importedModule,
    `Pi ${VERSION} retry indicator contract mismatch: invalid module`,
  );
  const constructor = moduleRecord["RetryStatusIndicator"];
  if (typeof constructor !== "function") {
    throw new Error(
      `Pi ${VERSION} retry indicator contract mismatch: missing RetryStatusIndicator`,
    );
  }
  const prototype = requireRecord(
    Reflect.get(constructor, "prototype"),
    `Pi ${VERSION} retry indicator contract mismatch: invalid RetryStatusIndicator prototype`,
  );
  requireCallableMethod(prototype, RETRY_INDICATOR_SET_TEXT_METHOD, 1, VERSION);
  return prototype;
}

export function installInfiniteRetryIndicatorPatch(
  options: RetryIndicatorPatchOptions,
): RetryIndicatorPatchLease {
  const runtimeVersion = options.runtimeVersion ?? VERSION;
  assertSupportedPiVersion(runtimeVersion);

  const prototype = options.prototype;
  let registry = globalThis.onurPiInfiniteRetryIndicatorPatchV1;
  if (registry !== undefined) {
    if (registry.prototype !== prototype) {
      throw new Error(
        "Infinite Retry indicator is already installed on a different RetryStatusIndicator prototype",
      );
    }
    registry.leases += 1;
    return createRetryIndicatorLease(registry);
  }

  const ownSetTextDescriptor = Object.getOwnPropertyDescriptor(
    prototype,
    RETRY_INDICATOR_SET_TEXT_METHOD,
  );
  assertPatchableRetryIndicator(prototype, ownSetTextDescriptor, runtimeVersion);
  const originalSetText = requireCallableMethod(
    prototype,
    RETRY_INDICATOR_SET_TEXT_METHOD,
    1,
    runtimeVersion,
  );
  const patchedSetText: OneArgumentMethod = function (this: unknown, text: unknown): unknown {
    const visibleText = typeof text === "string" ? hideInfiniteRetryDenominator(text) : text;
    return Reflect.apply(originalSetText, this, [visibleText]);
  };
  registry = {
    prototype,
    ownSetTextDescriptor,
    originalSetText,
    patchedSetText,
    leases: 1,
  };
  Object.defineProperty(prototype, RETRY_INDICATOR_SET_TEXT_METHOD, {
    configurable: true,
    enumerable: ownSetTextDescriptor?.enumerable ?? false,
    value: patchedSetText,
    writable: true,
  });
  globalThis.onurPiInfiniteRetryIndicatorPatchV1 = registry;
  return createRetryIndicatorLease(registry);
}

export function hideInfiniteRetryDenominator(text: string): string {
  return text.replace(INFINITE_ATTEMPT_SUFFIX, ")");
}

export function installInfiniteRetryPatch(
  options: InfiniteRetryPatchOptions = {},
): InfiniteRetryPatchLease {
  const runtimeVersion = options.runtimeVersion ?? VERSION;
  assertSupportedPiVersion(runtimeVersion);

  const prototype = options.prototype ?? AgentSession.prototype;
  const maxDelayMs = options.maxDelayMs ?? MAX_RETRY_DELAY_MS;
  calculateRetryDelayMs(1, 1, maxDelayMs);

  let registry = globalThis.onurPiInfiniteRetryPatchV1;
  if (registry !== undefined) {
    if (registry.prototype !== prototype) {
      throw new Error("Infinite Retry is already installed on a different AgentSession prototype");
    }
    registry.leases += 1;
    return createLease(registry);
  }

  const prepareDescriptor = requirePatchableMethodDescriptor(
    prototype,
    PREPARE_RETRY_METHOD,
    1,
    runtimeVersion,
  );
  const willRetryDescriptor = requirePatchableMethodDescriptor(
    prototype,
    WILL_RETRY_METHOD,
    1,
    runtimeVersion,
  );
  requireMethod(prototype, "_isRetryableError", 1, runtimeVersion);
  requireMethod(prototype, "abortRetry", 0, runtimeVersion);
  registry = {
    prototype,
    prepareDescriptor,
    willRetryDescriptor,
    leases: 1,
    reporters: new Set(),
    status: { state: "idle" },
    wait: undefined,
  };

  installMethods(registry, maxDelayMs);
  globalThis.onurPiInfiniteRetryPatchV1 = registry;
  return createLease(registry);
}

function installMethods(registry: PatchRegistry, maxDelayMs: number): void {
  const prepareRetry = async function (this: unknown, message: unknown): Promise<boolean> {
    const settings = readRetrySettings(this);
    if (!settings.enabled) return false;

    const attempt = Math.min(readNumber(this, "_retryAttempt") + 1, INFINITE_ATTEMPTS);
    writeField(this, "_retryAttempt", attempt);
    const delayMs = calculateRetryDelayMs(settings.baseDelayMs, attempt, maxDelayMs);
    emit(this, {
      type: "auto_retry_start",
      attempt,
      maxAttempts: INFINITE_ATTEMPTS,
      delayMs,
      errorMessage: readErrorMessage(message),
    });
    removeTrailingAssistantError(this);

    const wait = new RetryWait(delayMs);
    if (registry.wait !== undefined) {
      wait.cancel();
      throw new Error("Infinite Retry detected overlapping retry waits");
    }
    registry.wait = wait;
    writeField(this, "_retryAbortController", wait.controller);
    report(registry, { state: "waiting", attempt, delayMs, dueAt: wait.dueAt });

    try {
      const outcome = await wait.result;
      if (outcome !== "cancel") return true;

      writeField(this, "_retryAttempt", 0);
      emit(this, {
        type: "auto_retry_end",
        success: false,
        attempt,
        finalError: "Retry cancelled",
      });
      return false;
    } finally {
      if (registry.wait === wait) registry.wait = undefined;
      writeField(this, "_retryAbortController", undefined);
      report(registry, { state: "idle" });
    }
  };

  const willRetryAfterAgentEnd = function (this: unknown, event: unknown): boolean {
    const settings = readRetrySettings(this);
    if (!settings.enabled) return false;
    const messages = readArrayField(event, "messages");
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isRecord(message) && message["role"] === "assistant") {
        return callBooleanMethod(this, "_isRetryableError", message);
      }
    }
    return false;
  };

  Object.defineProperty(registry.prototype, PREPARE_RETRY_METHOD, {
    ...registry.prepareDescriptor,
    value: prepareRetry,
  });
  Object.defineProperty(registry.prototype, WILL_RETRY_METHOD, {
    ...registry.willRetryDescriptor,
    value: willRetryAfterAgentEnd,
  });
}

function createRetryIndicatorLease(
  registry: RetryIndicatorPatchRegistry,
): RetryIndicatorPatchLease {
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      registry.leases -= 1;
      if (registry.leases > 0) return;
      const current = Object.getOwnPropertyDescriptor(
        registry.prototype,
        RETRY_INDICATOR_SET_TEXT_METHOD,
      );
      if (current?.value === registry.patchedSetText) {
        if (registry.ownSetTextDescriptor === undefined) {
          Reflect.deleteProperty(registry.prototype, RETRY_INDICATOR_SET_TEXT_METHOD);
        } else {
          Object.defineProperty(
            registry.prototype,
            RETRY_INDICATOR_SET_TEXT_METHOD,
            registry.ownSetTextDescriptor,
          );
        }
      }
      if (globalThis.onurPiInfiniteRetryIndicatorPatchV1 === registry) {
        globalThis.onurPiInfiniteRetryIndicatorPatchV1 = undefined;
      }
    },
  };
}

function createLease(registry: PatchRegistry): InfiniteRetryPatchLease {
  let released = false;
  return {
    getStatus: () => getStatus(registry),
    onStatus: (reporter) => {
      registry.reporters.add(reporter);
      reporter(getStatus(registry));
      return () => registry.reporters.delete(reporter);
    },
    release: () => {
      if (released) return;
      released = true;
      registry.leases -= 1;
      if (registry.leases > 0) return;
      registry.wait?.cancel();
      Object.defineProperty(registry.prototype, PREPARE_RETRY_METHOD, registry.prepareDescriptor);
      Object.defineProperty(registry.prototype, WILL_RETRY_METHOD, registry.willRetryDescriptor);
      registry.reporters.clear();
      if (globalThis.onurPiInfiniteRetryPatchV1 === registry) {
        globalThis.onurPiInfiniteRetryPatchV1 = undefined;
      }
    },
    retryNow: () => registry.wait?.wake() ?? false,
  };
}

function getStatus(registry: PatchRegistry): RetryStatus {
  return registry.status;
}

function report(registry: PatchRegistry, status: RetryStatus): void {
  registry.status = status;
  for (const reporter of registry.reporters) reporter(status);
}

function assertSupportedPiVersion(runtimeVersion: string): void {
  const runtime = parsePiVersion(runtimeVersion);
  const minimum = parsePiVersion(MINIMUM_PI_VERSION);
  if (runtime === undefined || minimum === undefined || compareVersions(runtime, minimum) < 0) {
    throw new Error(
      `Infinite Retry requires Pi ${MINIMUM_PI_VERSION} or newer with the compatible private retry contract; found ${runtimeVersion}.`,
    );
  }
}

type ParsedVersion = readonly [major: number, minor: number, patch: number];

function parsePiVersion(version: string): ParsedVersion | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version);
  if (match === null) return undefined;
  const parsed = match.slice(1, 4).map(Number);
  if (parsed.some((part) => !Number.isSafeInteger(part))) return undefined;
  return [parsed[0] ?? 0, parsed[1] ?? 0, parsed[2] ?? 0];
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function assertPatchableRetryIndicator(
  prototype: object,
  ownDescriptor: PropertyDescriptor | undefined,
  runtimeVersion: string,
): void {
  if (ownDescriptor === undefined) {
    if (!Object.isExtensible(prototype)) {
      throw new Error(
        `Pi ${runtimeVersion} retry indicator contract mismatch: setText() is not patchable`,
      );
    }
    return;
  }
  if (ownDescriptor.configurable !== true || ownDescriptor.writable !== true) {
    throw new Error(
      `Pi ${runtimeVersion} retry indicator contract mismatch: setText() is not patchable`,
    );
  }
}

function requireCallableMethod(
  prototype: object,
  name: string,
  arity: number,
  runtimeVersion: string,
): OneArgumentMethod {
  const method: unknown = Reflect.get(prototype, name);
  if (typeof method !== "function" || method.length !== arity) {
    throw new Error(
      `Pi ${runtimeVersion} retry indicator contract mismatch: expected ${name}() with ${String(arity)} parameter(s)`,
    );
  }
  return method as OneArgumentMethod;
}

function requirePatchableMethodDescriptor(
  prototype: object,
  name: string,
  arity: number,
  runtimeVersion: string,
): PropertyDescriptor {
  const descriptor = requireMethod(prototype, name, arity, runtimeVersion);
  if (descriptor.configurable !== true || descriptor.writable !== true) {
    throw new Error(`Pi ${runtimeVersion} retry contract mismatch: ${name}() is not patchable`);
  }
  return descriptor;
}

function requireMethod(
  prototype: object,
  name: string,
  arity: number,
  runtimeVersion: string,
): PropertyDescriptor {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
  const method: unknown = descriptor?.value;
  if (descriptor === undefined || typeof method !== "function" || method.length !== arity) {
    throw new Error(
      `Pi ${runtimeVersion} retry contract mismatch: expected ${name}() with ${String(arity)} parameter(s)`,
    );
  }
  return descriptor;
}

function readRetrySettings(value: unknown): { enabled: boolean; baseDelayMs: number } {
  const manager = readRecordField(value, "settingsManager");
  const settings = callMethod(manager, "getRetrySettings");
  if (!isRecord(settings) || typeof settings["enabled"] !== "boolean") {
    throw new Error("Pi retry contract mismatch: invalid retry settings");
  }
  const baseDelayMs = settings["baseDelayMs"];
  if (typeof baseDelayMs !== "number") {
    throw new Error("Pi retry contract mismatch: invalid retry base delay");
  }
  return { enabled: settings["enabled"], baseDelayMs };
}

function removeTrailingAssistantError(value: unknown): void {
  const agent = readRecordField(value, "agent");
  const state = readRecordField(agent, "state");
  const messages = readArrayField(state, "messages");
  const last = messages.at(-1);
  if (isRecord(last) && last["role"] === "assistant") {
    writeField(state, "messages", messages.slice(0, -1));
  }
}

function emit(value: unknown, event: Record<string, unknown>): void {
  callMethod(value, "_emit", event);
}

function readErrorMessage(message: unknown): string {
  if (isRecord(message) && typeof message["errorMessage"] === "string") {
    return message["errorMessage"];
  }
  return "Unknown error";
}

function callBooleanMethod(value: unknown, name: string, argument: unknown): boolean {
  return callMethod(value, name, argument) === true;
}

function callMethod(value: unknown, name: string, ...arguments_: unknown[]): unknown {
  const record = requireRecord(value, `Pi retry contract mismatch: missing ${name} receiver`);
  const method = record[name];
  if (typeof method !== "function") {
    throw new Error(`Pi retry contract mismatch: missing ${name}()`);
  }
  return Reflect.apply(method, value, arguments_);
}

function readNumber(value: unknown, name: string): number {
  const record = requireRecord(value, `Pi retry contract mismatch: missing ${name}`);
  const field = record[name];
  if (typeof field !== "number" || !Number.isSafeInteger(field) || field < 0) {
    throw new Error(`Pi retry contract mismatch: invalid ${name}`);
  }
  return field;
}

function readRecordField(value: unknown, name: string): Record<string, unknown> {
  const record = requireRecord(value, `Pi retry contract mismatch: missing ${name}`);
  return requireRecord(record[name], `Pi retry contract mismatch: invalid ${name}`);
}

function readArrayField(value: unknown, name: string): unknown[] {
  const record = requireRecord(value, `Pi retry contract mismatch: missing ${name}`);
  const field = record[name];
  if (!Array.isArray(field)) throw new Error(`Pi retry contract mismatch: invalid ${name}`);
  return field;
}

function writeField(value: unknown, name: string, field: unknown): void {
  const record = requireRecord(value, `Pi retry contract mismatch: missing ${name}`);
  record[name] = field;
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
