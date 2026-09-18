import { describe, expect, it, vi } from "vitest";

import {
  formatBytes,
  handleSessionPolicyCommand,
  sessionPolicyReport,
  type SessionPolicySnapshot,
} from "./command.ts";
import { DEFAULT_CONFIG } from "./config.ts";

function snapshot(overrides: Partial<SessionPolicySnapshot> = {}): SessionPolicySnapshot {
  return {
    configPath: "/home/onur/.pi/agent/session-policy.json",
    config: DEFAULT_CONFIG,
    errors: [],
    cacheBytes: 2048,
    cacheCount: 2,
    liveMarkers: 3,
    ejected: 4,
    ...overrides,
  };
}

function recorder(): {
  ctx: { ui: { notify: (message: string, type: "info" | "warning" | "error") => void } };
  notifications: { message: string; type: string }[];
} {
  const notifications: { message: string; type: string }[] = [];
  return {
    ctx: {
      ui: {
        notify: (message, type) => {
          notifications.push({ message, type });
        },
      },
    },
    notifications,
  };
}

describe("formatBytes", () => {
  it("scales from bytes to kilobytes and megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(409600)).toBe("400 KB");
    expect(formatBytes(64 * 1024 * 1024)).toBe("64.0 MB");
  });
});

describe("sessionPolicyReport", () => {
  it("reports the config path, the limits, and the cache state", () => {
    const report = sessionPolicyReport(snapshot());
    expect(report.split("\n")).toEqual([
      "session-policy: enabled",
      "config: /home/onur/.pi/agent/session-policy.json",
      "per image: 400 KB at 1600x1600",
      "cache: 2 KB of 64.0 MB in 2 images",
      "live markers: 3",
      "ejected payloads: 4",
    ]);
  });

  it("reports a disabled policy and singular counts", () => {
    const report = sessionPolicyReport(
      snapshot({ config: { ...DEFAULT_CONFIG, enabled: false }, cacheCount: 1 }),
    );
    expect(report).toContain("session-policy: disabled");
    expect(report).toContain("in 1 image");
    expect(report).not.toContain("in 1 images");
  });

  it("lists config problems", () => {
    const report = sessionPolicyReport(snapshot({ errors: ["unknown key: cacheSize"] }));
    expect(report).toContain("config problems: unknown key: cacheSize");
  });
});

describe("handleSessionPolicyCommand", () => {
  it("reports the status for an empty argument", () => {
    const { ctx, notifications } = recorder();
    handleSessionPolicyCommand("", { snapshot: () => snapshot(), reload: () => [] }, ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.type).toBe("info");
    expect(notifications[0]?.message).toContain("session-policy: enabled");
  });

  it("accepts an explicit status argument", () => {
    const { ctx, notifications } = recorder();
    handleSessionPolicyCommand(" status ", { snapshot: () => snapshot(), reload: () => [] }, ctx);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.message).toContain("live markers: 3");
  });

  it("reloads and reports the errors it finds", () => {
    const { ctx, notifications } = recorder();
    const reload = vi.fn(() => ["maxImageBytes must be a positive whole number"]);
    handleSessionPolicyCommand("reload", { snapshot: () => snapshot(), reload }, ctx);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(notifications[0]).toEqual({
      message: "session-policy: maxImageBytes must be a positive whole number",
      type: "warning",
    });
    expect(notifications[1]?.message).toContain("session-policy: enabled");
  });

  it("reloads without a warning when the file is valid", () => {
    const { ctx, notifications } = recorder();
    handleSessionPolicyCommand("reload", { snapshot: () => snapshot(), reload: () => [] }, ctx);
    expect(notifications).toHaveLength(1);
  });

  it("shows the usage for anything else", () => {
    const { ctx, notifications } = recorder();
    const reload = vi.fn(() => []);
    handleSessionPolicyCommand("nonsense", { snapshot: () => snapshot(), reload }, ctx);
    expect(reload).not.toHaveBeenCalled();
    expect(notifications).toEqual([
      { message: "Usage: /session-policy [status|reload]", type: "warning" },
    ]);
  });
});
