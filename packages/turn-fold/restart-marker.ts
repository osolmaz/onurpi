import type { TurnFoldConfiguration } from "./configuration.ts";

const RESTART_MARKERS = Symbol.for("onurpi.turn-fold.restart-markers");

export type RestartMarker = Readonly<{
  applied: TurnFoldConfiguration;
  requested: TurnFoldConfiguration;
}>;

function isPreCompaction(value: unknown): boolean {
  return value === "show" || value === "hide";
}

function isWindows(value: unknown): boolean {
  return value === "all" || (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}

function isConfiguration(value: unknown): value is TurnFoldConfiguration {
  return (
    typeof value === "object" &&
    value !== null &&
    isPreCompaction(Reflect.get(value, "preCompaction")) &&
    isWindows(Reflect.get(value, "windows"))
  );
}

function isRestartMarker(value: unknown): value is RestartMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    isConfiguration(Reflect.get(value, "applied")) &&
    isConfiguration(Reflect.get(value, "requested"))
  );
}

function isRestartMarkerMap(value: unknown): value is Map<string, RestartMarker> {
  if (!(value instanceof Map)) return false;
  for (const [key, marker] of value) {
    if (typeof key !== "string" || !isRestartMarker(marker)) return false;
  }
  return true;
}

function markers(): Map<string, RestartMarker> {
  const existing: unknown = Reflect.get(globalThis, RESTART_MARKERS);
  if (isRestartMarkerMap(existing)) return existing;
  const created = new Map<string, RestartMarker>();
  Reflect.set(globalThis, RESTART_MARKERS, created);
  return created;
}

export function restartMarker(sessionKey: string): RestartMarker | undefined {
  return markers().get(sessionKey);
}

export function matchingRestartMarker(
  sessionKey: string,
  requested: TurnFoldConfiguration,
): RestartMarker | undefined {
  const marker = restartMarker(sessionKey);
  if (!marker) return undefined;
  if (
    marker.requested.preCompaction === requested.preCompaction &&
    marker.requested.windows === requested.windows
  ) {
    return marker;
  }
  clearRestartMarker(sessionKey);
  return undefined;
}

export function rememberRestartMarker(sessionKey: string, marker: RestartMarker): void {
  markers().set(sessionKey, marker);
}

export function clearRestartMarker(sessionKey?: string): void {
  if (sessionKey === undefined) markers().clear();
  else markers().delete(sessionKey);
}
