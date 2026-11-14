import { type ExtensionAPI, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import stickyPrompt, { SUPPORTED_PI_RANGE, supportsPiVersion } from "./index.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

function harness() {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (event: string, handler: unknown) => {
      handlers.set(event, handler as Handler);
    },
  };
  stickyPrompt(pi as unknown as ExtensionAPI);
  const emit = (event: string, ctx: unknown = {}): unknown => {
    const handler = handlers.get(event);
    if (!handler) throw new Error(`${event} handler is not registered`);
    return handler({}, ctx);
  };
  return { emit };
}

initTheme("dark", false);

describe("sticky prompt extension", () => {
  it.each(["1.5.0", "1.5.2", "2.0.0"])("supports Pi %s", (version) => {
    expect(supportsPiVersion(version)).toBe(true);
  });

  it.each(["1.4.9", "0.99.0", "1.5", "invalid", "1.5.2-beta.1"])("rejects Pi %s", (version) => {
    expect(supportsPiVersion(version)).toBe(false);
  });

  it("installs the patches and restores them at shutdown", () => {
    const original: unknown = Container.prototype.render;
    const { emit } = harness();

    expect(Container.prototype.render).not.toBe(original);

    emit("session_shutdown");

    expect(Container.prototype.render).toBe(original);
  });

  it("remembers the theme from each event that carries one", () => {
    const theme = {} as Theme;
    const { emit } = harness();

    for (const event of ["session_start", "message_update", "tool_execution_start", "turn_start"]) {
      expect(() => {
        emit(event, { ui: { theme } });
      }).not.toThrow();
    }
    expect(() => {
      emit("agent_settled", { ui: { theme } });
    }).not.toThrow();
  });

  it("publishes the supported Pi range", () => {
    expect(SUPPORTED_PI_RANGE).toBe(">=1.5.0");
  });
});
