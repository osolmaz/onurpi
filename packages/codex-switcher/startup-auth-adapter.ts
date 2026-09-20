import { ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";

const ADAPTER_STATE_KEY = Symbol.for("@onurpi/codex-switcher/startup-auth-adapter.v1");
const PROVIDER_ID = "openai-codex";
const MINIMUM_MINOR = 84;
const MINIMUM_PATCH = 2;
const MINIMUM_VERSION = [0, MINIMUM_MINOR, MINIMUM_PATCH];
const SUPPORTED_PI_RANGE = `>=${MINIMUM_VERSION.join(".")}`;

type AuthCheck = (this: object, providerId: string) => boolean;

type AuthRuntimePrototype = {
  hasConfiguredAuth: AuthCheck;
};

type ReadinessCheck = {
  readonly isReady: () => boolean;
  readonly onCheck?: () => void;
};

type AdapterState = {
  readonly checks: Map<symbol, ReadinessCheck>;
  readonly original: AuthCheck;
  readonly patched: AuthCheck;
};

export type StartupAuthAdapterOptions = {
  readonly isReady: () => boolean;
  readonly onCheck?: () => void;
  readonly piVersion?: string;
  readonly runtimePrototype?: AuthRuntimePrototype;
};

export type RestoreStartupAuthAdapter = () => void;

function object(value: unknown): Record<PropertyKey, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<PropertyKey, unknown>)
    : undefined;
}

function isAdapterState(value: unknown): value is AdapterState {
  const candidate = object(value);
  return (
    candidate?.["checks"] instanceof Map &&
    typeof candidate["original"] === "function" &&
    typeof candidate["patched"] === "function"
  );
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function supportedPiVersion(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  return parts.every(Number.isSafeInteger) && compareVersions(parts, MINIMUM_VERSION) >= 0;
}

function assertSupportedPiVersion(version: string): void {
  if (supportedPiVersion(version)) return;
  throw new Error(
    `Codex switcher session restore supports Pi ${SUPPORTED_PI_RANGE}; found ${version}.`,
  );
}

function stateFor(prototype: AuthRuntimePrototype): AdapterState {
  const stored: unknown = Reflect.get(prototype, ADAPTER_STATE_KEY);
  if (isAdapterState(stored)) return stored;
  if (stored !== undefined) throw new Error("Codex switcher startup adapter state is invalid.");

  const original = prototype.hasConfiguredAuth;
  if (typeof original !== "function") {
    throw new Error("Pi ModelRuntime.hasConfiguredAuth is unavailable.");
  }
  const checks = new Map<symbol, ReadinessCheck>();
  const patched: AuthCheck = function (providerId) {
    if (providerId === PROVIDER_ID) {
      let ready = false;
      for (const check of checks.values()) {
        try {
          if (check.isReady()) ready = true;
        } catch {
          // Invalid provider-owned state delegates to Pi's original readiness result.
        } finally {
          check.onCheck?.();
        }
      }
      if (ready) return true;
    }
    return Reflect.apply(original, this, [providerId]);
  };
  const state: AdapterState = { checks, original, patched };
  if (
    !Reflect.defineProperty(prototype, ADAPTER_STATE_KEY, {
      configurable: true,
      enumerable: false,
      value: state,
      writable: false,
    })
  ) {
    throw new Error("Unable to install Codex switcher startup adapter state.");
  }
  try {
    prototype.hasConfiguredAuth = patched;
  } catch (error) {
    Reflect.deleteProperty(prototype, ADAPTER_STATE_KEY);
    throw error;
  }
  return state;
}

export function installStartupAuthAdapter(
  options: StartupAuthAdapterOptions,
): RestoreStartupAuthAdapter {
  assertSupportedPiVersion(options.piVersion ?? VERSION);
  const prototype = options.runtimePrototype ?? (ModelRuntime.prototype as AuthRuntimePrototype);
  const state = stateFor(prototype);
  const token = Symbol("codex-switcher-startup-auth");
  state.checks.set(token, {
    isReady: options.isReady,
    ...(options.onCheck === undefined ? {} : { onCheck: options.onCheck }),
  });
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    state.checks.delete(token);
    if (state.checks.size > 0) return;
    if (prototype.hasConfiguredAuth === state.patched) {
      prototype.hasConfiguredAuth = state.original;
      Reflect.deleteProperty(prototype, ADAPTER_STATE_KEY);
    }
  };
}
