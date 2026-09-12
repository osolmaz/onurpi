import { describe, expect, it, vi } from "vitest";

import {
  handleImageBudgetCommand,
  imageBudgetReport,
  type ImageBudgetSnapshot,
} from "./command.ts";
import { DEFAULT_CONFIG } from "./image-budget.ts";

function snapshot(overrides: Partial<ImageBudgetSnapshot> = {}): ImageBudgetSnapshot {
  return {
    configPath: "/home/user/.pi/agent/image-budget.json",
    config: DEFAULT_CONFIG,
    errors: [],
    lastBytes: 0,
    lastImageCount: 0,
    redactions: 0,
    outcome: { omitted: 0, resized: 0, dropped: 0, bytesSaved: 0 },
    ...overrides,
  };
}

function notifyRecorder() {
  const notify = vi.fn();
  return { ctx: { ui: { notify } }, notify };
}

describe("imageBudgetReport", () => {
  it("reports the limits and the current load", () => {
    const report = imageBudgetReport(snapshot({ lastBytes: 2_000_000, lastImageCount: 12 }));
    expect(report).toContain("image-budget: enabled");
    expect(report).toContain("/home/user/.pi/agent/image-budget.json");
    expect(report).toContain("per image: 400 KB at 1600x1600, 4 per tool result");
    expect(report).toContain("request: redact above 3.5 MB down to 2.5 MB");
    expect(report).toContain("current context: 1.9 MB in 12 images");
    expect(report).toContain("redacted this session: 0");
    expect(report).toContain("tool results: nothing changed");
  });

  it("reports what the tool result policy changed", () => {
    const report = imageBudgetReport(
      snapshot({
        config: { ...DEFAULT_CONFIG, enabled: false },
        errors: ["unknown key: typo"],
        outcome: { omitted: 1, resized: 2, dropped: 0, bytesSaved: 4096 },
      }),
    );
    expect(report).toContain("(disabled)");
    expect(report).toContain("tool results: image-budget: re-encoded 2, omitted 1 images");
    expect(report).toContain("config problems: unknown key: typo");
  });
});

describe("handleImageBudgetCommand", () => {
  it("prints the report for no argument and for status", () => {
    const { ctx, notify } = notifyRecorder();
    const deps = { reload: vi.fn(() => []), snapshot: () => snapshot() };
    handleImageBudgetCommand("", deps, ctx);
    handleImageBudgetCommand("  status ", deps, ctx);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      expect.stringContaining("image-budget: enabled"),
      "info",
    );
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("reloads and reports config problems", () => {
    const { ctx, notify } = notifyRecorder();
    handleImageBudgetCommand(
      "reload",
      { reload: () => ["bad key"], snapshot: () => snapshot() },
      ctx,
    );
    expect(notify).toHaveBeenNthCalledWith(1, "image-budget: bad key", "warning");
    expect(notify).toHaveBeenNthCalledWith(2, expect.stringContaining("image-budget"), "info");
  });

  it("reloads without a warning when the config is clean", () => {
    const { ctx, notify } = notifyRecorder();
    handleImageBudgetCommand("reload", { reload: () => [], snapshot: () => snapshot() }, ctx);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("shows usage for an unknown argument", () => {
    const { ctx, notify } = notifyRecorder();
    const snapshotFn = vi.fn(() => snapshot());
    handleImageBudgetCommand("wat", { reload: () => [], snapshot: snapshotFn }, ctx);
    expect(notify).toHaveBeenCalledWith("Usage: /image-budget [status|reload]", "warning");
    expect(snapshotFn).not.toHaveBeenCalled();
  });
});
