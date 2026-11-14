import { InteractiveMode } from "@earendil-works/pi-coding-agent";

/**
 * Methods that run early and often. Any of them hands us the live InteractiveMode instance, which
 * is the only way to reach the editor, the session queue, and the submit path from an extension.
 */
export const CAPTURE_METHODS = [
  "handleEvent",
  "showStatus",
  "updatePendingMessagesDisplay",
] as const;

type InstalledMethod = {
  name: string;
  original: unknown;
  wrapper: (...args: unknown[]) => unknown;
};

export type ModeCapture = {
  current(): object | undefined;
  restore(): void;
};

export function installModeCapture(
  prototype: Record<string, unknown> = InteractiveMode.prototype as unknown as Record<
    string,
    unknown
  >,
): ModeCapture {
  const installed: InstalledMethod[] = [];
  let captured: object | undefined;

  for (const name of CAPTURE_METHODS) {
    const original: unknown = prototype[name];
    if (typeof original !== "function") continue;
    const call = original as (this: unknown, ...args: unknown[]) => unknown;
    function wrapper(this: unknown, ...args: unknown[]): unknown {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- the live instance is the capture
      if (typeof this === "object" && this !== null) captured = this;
      return call.apply(this, args);
    }
    prototype[name] = wrapper;
    installed.push({ name, original, wrapper });
  }

  return {
    current: () => captured,
    restore: () => {
      for (const { name, original, wrapper } of installed) {
        if (prototype[name] === wrapper) prototype[name] = original;
      }
      captured = undefined;
    },
  };
}
