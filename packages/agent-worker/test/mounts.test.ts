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
  it("mounts a host workspace read-write and the configuration read-only", () => {
    expect(
      sandboxDriverConfig(
        "docker",
        { kind: "host", path: "/srv/workspace" },
        { kind: "host", path: "/srv/config" },
      ),
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
      sandboxDriverConfig(
        "podman",
        { kind: "volume", name: "agent-workspace" },
        { kind: "volume", name: "agent.config" },
      ),
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
    expect(() =>
      sandboxDriverConfig("docker", { kind: "host", path: "workspace" }, config),
    ).toThrow("A host folder must be an absolute path");
    expect(() => sandboxDriverConfig("docker", { kind: "volume", name: "../etc" }, config)).toThrow(
      "A volume name may hold only",
    );
  });

  it("adds the global instructions file read-only when given", () => {
    const driver = sandboxDriverConfig(
      "docker",
      { kind: "host", path: "/srv/workspace" },
      { kind: "host", path: "/srv/config" },
      { kind: "host", path: "/srv/pi/AGENTS.md" },
    );
    expect(driver["docker"]?.mounts[2]).toEqual({
      read_only: true,
      source: "/srv/pi/AGENTS.md",
      target: INSTRUCTIONS_TARGET,
      type: "bind",
    });
  });
});
