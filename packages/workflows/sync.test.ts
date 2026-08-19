import type { SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncWorkflows } from "./sync.ts";

function reply(
  value: unknown,
  overrides: Partial<SpawnSyncReturns<string>> = {},
): SpawnSyncReturns<string> {
  const stdout = typeof value === "string" ? value : JSON.stringify(value);
  return {
    pid: 1,
    output: [null, stdout, ""],
    stdout,
    stderr: "",
    status: 0,
    signal: null,
    ...overrides,
  };
}

function result(
  status: "linked" | "relinked" | "enabled" | "unchanged" | "unavailable",
): Record<string, unknown> {
  const unavailable = status === "unavailable";
  return {
    schema: "pi-workflows.herdr-sync.v1",
    status,
    changed: status !== "unchanged" && !unavailable,
    pluginId: "example.plugin",
    expectedVersion: "1.2.3",
    effectiveVersion: unavailable ? null : "1.2.3",
    enabled: unavailable ? null : true,
    runningPiProcessesNeedReload: true,
    message: unavailable ? "Herdr is unavailable." : "Synchronization complete.",
  };
}

describe("syncWorkflows", () => {
  it.each(["linked", "relinked", "enabled", "unchanged", "unavailable"] as const)(
    "accepts the %s upstream result",
    (status) => {
      const calls: { command: string; args: readonly string[] }[] = [];
      const actual = syncWorkflows((command, args) => {
        calls.push({ command, args });
        return reply(result(status));
      });

      expect(actual.status).toBe(status);
      expect(calls).toEqual([{ command: "pi-workflows", args: ["herdr", "sync", "--json"] }]);
    },
  );

  it("rejects command and executable failures", () => {
    expect(() =>
      syncWorkflows(() => reply("", { status: 1, stderr: "registration failed" })),
    ).toThrow("Pi Workflows synchronization failed: registration failed");
    expect(() =>
      syncWorkflows(() => reply("", { error: new Error("spawn pi-workflows ENOENT") })),
    ).toThrow("Could not run Pi Workflows synchronization: spawn pi-workflows ENOENT");
  });

  it("rejects malformed, unsupported, incomplete, and inconsistent results", () => {
    expect(() => syncWorkflows(() => reply("{"))).toThrow("invalid synchronization JSON");
    expect(() => syncWorkflows(() => reply({ ...result("unchanged"), schema: "old" }))).toThrow(
      "unsupported synchronization result",
    );
    expect(() => syncWorkflows(() => reply({ ...result("unchanged"), status: "other" }))).toThrow(
      "invalid synchronization status",
    );
    expect(() => syncWorkflows(() => reply({ ...result("unchanged"), message: 1 }))).toThrow(
      "incomplete synchronization result",
    );
    expect(() =>
      syncWorkflows(() => reply({ ...result("unavailable"), effectiveVersion: "1.2.3" })),
    ).toThrow("inconsistent synchronization result");
    expect(() => syncWorkflows(() => reply({ ...result("unchanged"), enabled: false }))).toThrow(
      "inconsistent synchronization result",
    );
  });

  it("keeps Herdr registration details in the upstream package", () => {
    const source = fs.readFileSync(path.join(import.meta.dirname, "sync.ts"), "utf8");
    expect(source).not.toContain("osolmaz.pi-workflows");
    expect(source).not.toContain("node_modules");
    expect(source).not.toContain("herdr-plugin.toml");
    expect(source).not.toMatch(/\["plugin",\s*"(?:link|unlink|enable)"/u);
  });

  it("bounds command failure output", () => {
    expect(() => syncWorkflows(() => reply("", { status: 1, stderr: "x".repeat(400) }))).toThrow(
      /x+…/u,
    );
  });
});
