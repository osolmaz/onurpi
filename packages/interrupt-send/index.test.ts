import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import interruptSend, { interruptTarget, SHORTCUT } from "./index.ts";

function mode(overrides: { onSubmit?: unknown; session?: object } = {}) {
  const submitted: string[] = [];
  const statuses: string[] = [];
  const onSubmit =
    overrides.onSubmit ??
    ((text: string) => {
      submitted.push(text);
    });
  const session = overrides.session ?? {
    abort: () => Promise.resolve(),
    clearQueue: () => ({ followUp: [], steering: [] }),
    followUp: () => Promise.resolve(),
    isCompacting: false,
    isStreaming: false,
    steer: () => Promise.resolve(),
  };
  const value = {
    defaultEditor: { onSubmit },
    editor: { getText: () => "typed", setText: () => undefined },
    session,
    showStatus: (message: string) => {
      statuses.push(message);
    },
  };
  return { statuses, submitted, value };
}

function harness() {
  const shortcuts = new Map<string, { description?: string; handler: () => unknown }>();
  const handlers = new Map<string, () => unknown>();
  const pi = {
    on: (event: string, handler: unknown) => {
      handlers.set(event, handler as () => unknown);
    },
    registerShortcut: (shortcut: string, options: unknown) => {
      shortcuts.set(shortcut, options as { handler: () => unknown });
    },
  };
  interruptSend(pi as unknown as ExtensionAPI);
  return { handlers, shortcuts };
}

describe("interrupt send target", () => {
  it("submits through the default editor", () => {
    const { submitted, value } = mode();
    const target = interruptTarget(value);

    target?.submit("hello");

    expect(submitted).toEqual(["hello"]);
  });

  it("reports status through the interactive mode", () => {
    const { statuses, value } = mode();
    const target = interruptTarget(value);

    target?.showStatus("nothing here");

    expect(statuses).toEqual(["nothing here"]);
  });

  it("returns undefined when the mode is incomplete", () => {
    const { value } = mode({ onSubmit: undefined, session: {} });

    expect(interruptTarget(value)).toBeUndefined();
  });
});

describe("interrupt send extension", () => {
  it("registers the ctrl+enter shortcut", () => {
    const { shortcuts } = harness();

    expect(shortcuts.has(SHORTCUT)).toBe(true);
    expect(shortcuts.get(SHORTCUT)?.description).toContain("Interrupt");
  });

  it("does nothing before an interactive mode has been seen", () => {
    const { shortcuts } = harness();

    expect(() => shortcuts.get(SHORTCUT)?.handler()).not.toThrow();
  });

  it("restores the interactive mode prototype at shutdown", () => {
    const { handlers } = harness();

    expect(() => handlers.get("session_shutdown")?.()).not.toThrow();
  });
});
