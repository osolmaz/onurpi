import { describe, expect, it } from "vitest";

import { CAPTURE_METHODS, installModeCapture } from "./capture.ts";

function stubPrototype() {
  const calls: string[] = [];
  const prototype: Record<string, unknown> = {
    handleEvent: function (this: unknown) {
      calls.push(`handleEvent:${String(Reflect.get(this as object, "name"))}`);
      return "event";
    },
    showStatus: function (this: unknown, message: string) {
      calls.push(`showStatus:${message}`);
    },
    updatePendingMessagesDisplay: function () {
      calls.push("updatePendingMessagesDisplay");
    },
    untouched: function () {
      calls.push("untouched");
    },
  };
  return { calls, prototype };
}

describe("installModeCapture", () => {
  it("captures the instance that runs a patched method", () => {
    const { prototype } = stubPrototype();
    const capture = installModeCapture(prototype);
    const instance = { name: "mode" };

    expect(capture.current()).toBeUndefined();

    const handleEvent = prototype["handleEvent"] as (this: unknown) => unknown;
    expect(handleEvent.call(instance)).toBe("event");

    expect(capture.current()).toBe(instance);
  });

  it("keeps every patched method working", () => {
    const { calls, prototype } = stubPrototype();
    installModeCapture(prototype);
    const instance = { name: "mode" };

    (prototype["handleEvent"] as (this: unknown) => unknown).call(instance);
    (prototype["showStatus"] as (this: unknown, message: string) => void).call(instance, "hi");
    (prototype["updatePendingMessagesDisplay"] as () => void).call(instance);

    expect(calls).toEqual(["handleEvent:mode", "showStatus:hi", "updatePendingMessagesDisplay"]);
  });

  it("restores the original methods and forgets the instance", () => {
    const { prototype } = stubPrototype();
    const originals = CAPTURE_METHODS.map((name) => prototype[name]);
    const untouched = prototype["untouched"];
    const capture = installModeCapture(prototype);
    (prototype["handleEvent"] as (this: unknown) => unknown).call({ name: "mode" });

    capture.restore();

    expect(CAPTURE_METHODS.map((name) => prototype[name])).toEqual(originals);
    expect(prototype["untouched"]).toBe(untouched);
    expect(capture.current()).toBeUndefined();
  });

  it("skips a missing method instead of failing", () => {
    const prototype: Record<string, unknown> = {
      showStatus: function () {
        return "kept";
      },
    };

    const capture = installModeCapture(prototype);
    expect((prototype["showStatus"] as () => string)()).toBe("kept");
    expect(prototype["handleEvent"]).toBeUndefined();
    capture.restore();
    expect(prototype["showStatus"]).toBeDefined();
  });
});
