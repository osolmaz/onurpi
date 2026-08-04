import { afterEach, expect, it } from "vitest";

import { clearRestartMarker, rememberRestartMarker, restartMarker } from "./restart-marker.ts";

const allWindows = { preCompaction: "show", windows: "all" } as const;
const oneWindow = { preCompaction: "show", windows: 1 } as const;

afterEach(() => {
  clearRestartMarker();
});

it("keeps a pending configuration in process until it is cleared", () => {
  rememberRestartMarker("session", { applied: oneWindow, requested: allWindows });

  expect(restartMarker("session")).toEqual({ applied: oneWindow, requested: allWindows });
  clearRestartMarker("session");
  expect(restartMarker("session")).toBeUndefined();
});

it("replaces malformed shared state with an empty marker map", () => {
  Reflect.set(globalThis, Symbol.for("onurpi.turn-fold.restart-markers"), new Map([[1, null]]));

  expect(restartMarker("session")).toBeUndefined();
});
