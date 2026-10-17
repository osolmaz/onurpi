import { describe, expect, it } from "vitest";
import {
  CONFIG_TARGET,
  INSTRUCTIONS_TARGET,
  parseMountSource,
  sandboxDriverConfig,
  WORKSPACE_TARGET,
} from "../src/mounts.ts";

describe("parseMountSource", () => {
  it("reads host folders and named volumes", () => {
    expect(parseMountSource("host:/srv/agent/workspace")).toEqual({
      kind: "host",
      path: "/srv/agent/workspace",
    });
    expect(parseMountSource("volume:agent-workspace")).toEqual({
      kind: "volume",
      name: "agent-workspace",
    });
  });

  it.each(["/srv/agent/workspace", "disk:/x", ":/x"])("rejects %s", (value) => {
    expect(() => parseMountSource(value)).toThrow(
      "A mount must be host:/absolute/path or volume:name",
    );
  });
});

describe("sandboxDriverConfig", () => {
  const host = (path: string) => ({ kind: "host", path }) as const;

  it("mounts a host workspace read-write and the configuration read-only", () => {
    expect(
      sandboxDriverConfig("docker", {
        config: host("/srv/config"),
        workspace: host("/srv/workspace"),
      }),
    ).toEqual({
      docker: {
        mounts: [
          { read_only: false, source: "/srv/workspace", target: WORKSPACE_TARGET, type: "bind" },
          { read_only: true, source: "/srv/config", target: CONFIG_TARGET, type: "bind" },
        ],
      },
    });
  });

  it("uses named volumes under the chosen runtime", () => {
    expect(
      sandboxDriverConfig("podman", {
        config: { kind: "volume", name: "agent.config" },
        workspace: { kind: "volume", name: "agent-workspace" },
      }),
    ).toEqual({
      podman: {
        mounts: [
          { read_only: false, source: "agent-workspace", target: WORKSPACE_TARGET, type: "volume" },
          { read_only: true, source: "agent.config", target: CONFIG_TARGET, type: "volume" },
        ],
      },
    });
  });

  it("rejects a relative host folder and an unsafe volume name", () => {
    const config = { kind: "volume", name: "config" } as const;
    expect(() => sandboxDriverConfig("docker", { config, workspace: host("workspace") })).toThrow(
      "A host folder must be an absolute path",
    );
    expect(() =>
      sandboxDriverConfig("docker", { config, workspace: { kind: "volume", name: "../etc" } }),
    ).toThrow("A volume name may hold only");
  });

  it("adds the global instructions file read-only when given", () => {
    const driver = sandboxDriverConfig("docker", {
      config: host("/srv/config"),
      instructions: host("/srv/pi/AGENTS.md"),
      workspace: host("/srv/workspace"),
    });
    expect(driver["docker"]?.mounts[2]).toEqual({
      read_only: true,
      source: "/srv/pi/AGENTS.md",
      target: INSTRUCTIONS_TARGET,
      type: "bind",
    });
  });

  it("hides workspace folders with an empty tmpfs and files with /dev/null", () => {
    const driver = sandboxDriverConfig("docker", {
      config: host("/srv/config"),
      hide: ["secrets/", "tokens.env"],
      workspace: host("/srv/workspace"),
    });
    expect(driver["docker"]?.mounts.slice(2)).toEqual([
      { read_only: true, target: `${WORKSPACE_TARGET}/secrets`, type: "tmpfs" },
      {
        read_only: true,
        source: "/dev/null",
        target: `${WORKSPACE_TARGET}/tokens.env`,
        type: "bind",
      },
    ]);
  });

  it.each(["/etc/", "../outside", "a/../b", "", "./x"])("refuses to hide %j", (path) => {
    expect(() =>
      sandboxDriverConfig("docker", { config: host("/c"), hide: [path], workspace: host("/w") }),
    ).toThrow("A hidden path must be relative to the workspace");
  });
});
