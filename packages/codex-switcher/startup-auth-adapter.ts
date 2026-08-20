import { ModelRuntime, VERSION } from "@earendil-works/pi-coding-agent";

const ADAPTER_STATE_KEY = Symbol.for("@onurpi/codex-switcher/startup-auth-adapter.v1");
const PROVIDER_ID = "openai-codex";
const MINIMUM_PATCH = 2;

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

function assertSupportedPiVersion(version: string): void {
  const match = /^0\.84\.(\d+)$/u.exec(version);
  const patch = match?.[1] === undefined ? undefined : Number(match[1]);
  if (patch === undefined || !Number.isSafeInteger(patch) || patch < MINIMUM_PATCH) {
    throw new Error(
      `Codex switcher session restore supports Pi >=0.84.${String(MINIMUM_PATCH)} <0.85.0; found ${version}.`,
    );
  }
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
