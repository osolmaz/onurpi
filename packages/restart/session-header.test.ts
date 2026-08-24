import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readSessionHeader } from "./session-header.ts";

const roots: string[] = [];

function fixture(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "onurpi-restart-header-"));
  roots.push(root);
  const path = join(root, "session.jsonl");
  writeFileSync(path, content);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("session header", () => {
  it("reads only the documented first session record", () => {
    const path = fixture(
      `${JSON.stringify({ type: "session", id: "session-1", cwd: "/repo" })}\n${"x".repeat(100_000)}`,
    );
    expect(readSessionHeader(path)).toEqual({ type: "session", id: "session-1", cwd: "/repo" });
  });

  it.each([
    "",
    "not json\n",
    `${JSON.stringify({ type: "message", id: "one", cwd: "/repo" })}\n`,
    `${JSON.stringify({ type: "session", id: "", cwd: "/repo" })}\n`,
    `${JSON.stringify({ type: "session", id: "one" })}\n`,
  ])("rejects malformed header %#", (content) => {
    expect(() => readSessionHeader(fixture(content))).toThrow();
  });

  it("rejects an oversized first line", () => {
    expect(() => readSessionHeader(fixture("x".repeat(64 * 1024 + 1)))).toThrow(/64 KiB/u);
  });
});
