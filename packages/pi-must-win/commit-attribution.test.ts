import { existsSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { CommitAttributionSession } from "./features/commit-attribution.ts";

const sessions: CommitAttributionSession[] = [];

function createSession(): CommitAttributionSession {
  const session = new CommitAttributionSession();
  sessions.push(session);
  return session;
}

afterEach(() => {
  for (const session of sessions.splice(0)) session.stop();
});

describe("commit attribution session", () => {
  it("creates one hook directory per active session and removes it on stop", () => {
    const session = createSession();
    const firstDirectory = session.start();

    expect(existsSync(firstDirectory)).toBe(true);
    expect(session.start()).toBe(firstDirectory);

    session.stop();
    expect(existsSync(firstDirectory)).toBe(false);
    expect(() => {
      session.stop();
    }).not.toThrow();
  });

  it("starts lazily when wrapping a bash command and can start again after shutdown", () => {
    const session = createSession();
    const wrapped = session.wrap("git status", "Test Model", "0.80.10");

    expect(wrapped).toContain(
      "PI_MUST_WIN_CO_AUTHOR='Co-Authored-By: Test Model <noreply@pi.dev>'",
    );
    expect(wrapped).toContain("PI_MUST_WIN_GENERATED_BY='Generated-By: pi 0.80.10'");
    expect(wrapped).toMatch(/GIT_CONFIG_VALUE_.*pi-must-win-hooks-/);
    expect(wrapped.endsWith("\ngit status")).toBe(true);

    const firstDirectory = session.start();
    session.stop();
    const secondDirectory = session.start();
    expect(secondDirectory).not.toBe(firstDirectory);
  });
});
