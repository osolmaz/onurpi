import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const script = join(import.meta.dirname, "skills/design/scripts/demo-video/render.mjs");

function evaluate(expression: string): string {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import * as renderer from ${JSON.stringify(pathToFileURL(script).href)};\n${expression}`,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  if (result.status !== 0) throw new Error(result.stderr || "Renderer probe failed");
  return result.stdout.trim();
}

function cli(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 5000 });
}

describe("demo render helper", () => {
  it("loads without starting Chrome and exposes help", () => {
    expect(evaluate("console.log(typeof renderer.main)")).toBe("function");
    expect(cli(["--help"]).stdout).toContain("preview|poster|video");
  });

  it.each([
    ["bad-mode"],
    ["video", "--wat", "1"],
    ["video", "--out"],
    ["video", "--out", "one", "--out", "two"],
    ["video", "--fps", "0"],
    ["video", "--fps", "1.5"],
    ["video", "--duration", "NaN"],
  ])("rejects invalid arguments %j before browser startup", (...args: string[]) => {
    const result = cli(args);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("Chrome");
  });

  it("uses metadata and explicit overrides without clipping long-film times", () => {
    expect(
      evaluate(`console.log(JSON.stringify(renderer.resolveSettings(
      { fps: '24', poster: '100' }, { duration: 120, fps: 30, previewTimes: [0, 100] }
    )))`),
    ).toBe(
      JSON.stringify({
        fps: 24,
        duration: 120,
        total: 2880,
        previewTimes: [0, 100],
        posterTime: 100,
      }),
    );
    expect(
      evaluate("console.log(renderer.resolveSettings({}, {duration: 0.1}).previewTimes)"),
    ).toBe("[ 0 ]");
  });

  it.each([
    "{duration: 0}",
    "{fps: Infinity}",
    "{duration: true}",
    "{previewTimes: [0, 0]}",
    "{previewTimes: []}",
    "{previewTimes: [90]}",
    "{previewTimes: [null]}",
    "{posterTime: -1}",
  ])("rejects invalid page settings %s", (metadata) => {
    expect(
      evaluate(`try { renderer.resolveSettings({}, ${metadata}); }
      catch (error) { console.log(error.message); }`),
    ).toMatch(/Invalid|times|time/u);
  });

  it("uses non-overwriting encoding, stereo audio, and fast start", () => {
    const args = evaluate(
      "console.log(JSON.stringify(renderer.encoderArgs({fps: 30, duration: 1}, 'out.mp4', 'bed.wav')))",
    );
    expect(args).toContain('"-n"');
    expect(args).not.toContain('"-y"');
    expect(args).toContain('"-ac","2"');
    expect(args).toContain('"-ar","48000"');
    expect(args).toContain('"+faststart"');
  });

  it("refuses existing outputs without launching a browser", () => {
    const root = mkdtempSync(join(tmpdir(), "design-render-test-"));
    try {
      const page = join(root, "film.html");
      const stem = join(root, "film");
      writeFileSync(page, "<canvas></canvas>");
      writeFileSync(stem + ".mp4", "previous output");
      const result = cli(["video", "--page", page, "--out", stem]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Refusing to replace");
      expect(readFileSync(stem + ".mp4", "utf8")).toBe("previous output");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports a missing browser and exits without leaving a waiting cleanup", () => {
    const result = cli([
      "preview",
      "--page",
      script,
      "--chrome",
      "/nonexistent/design-test-browser",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENOENT");
    expect(result.error).toBeUndefined();
  });
});
