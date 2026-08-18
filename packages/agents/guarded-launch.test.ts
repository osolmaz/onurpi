import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const scriptDirectory = join(import.meta.dirname, "skills", "safe-inference-launch", "scripts");
const script = join(scriptDirectory, "guarded-launch.sh");
const installer = join(scriptDirectory, "install-shims.sh");

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-guarded-launch-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
});

describe("safe inference shim installation", () => {
  it("rejects unsafe tool names before writing outside the bin directory", () => {
    const root = temporaryDirectory();
    const result = spawnSync(
      installer,
      ["--bin-dir", join(root, "bin"), "--tools", "../escape", "--force"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("invalid tool name");
    expect(existsSync(join(root, "escape"))).toBe(false);
  });

  it("writes an absolute custom guard path into a shim", () => {
    const root = temporaryDirectory();
    const bin = join(root, "bin");
    const result = spawnSync(
      installer,
      ["--bin-dir", bin, "--tools", "test-tool", "--guard", relative(root, script)],
      { cwd: root, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(readFileSync(join(bin, "test-tool"), "utf8")).toContain(script);
  });
});

describe("guarded-launch process groups", () => {
  it("waits for background group members after the leader exits", () => {
    const root = temporaryDirectory();
    const marker = join(root, "background-finished");

    const result = spawnSync(
      script,
      [
        "--allow-no-earlyoom",
        "--min-mem-gb",
        "0",
        "--min-swap-gb",
        "0",
        "--poll-sec",
        "0.05",
        "--",
        "sh",
        "-c",
        `leader=$$; (while kill -0 "$leader" 2>/dev/null; do sleep 0.01; done; touch ${JSON.stringify(marker)}) >/dev/null 2>&1 & exit 0`,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(existsSync(marker)).toBe(true);
  });
});

describe("guarded-launch timing validation", () => {
  it.each([
    ["--poll-sec", "nope", "--poll-sec must be a positive number"],
    ["--poll-sec", "0", "--poll-sec must be a positive number"],
    ["--grace-sec", "nope", "--grace-sec must be numeric"],
  ])("rejects %s=%s before starting the child", (option, value, message) => {
    const root = temporaryDirectory();
    const marker = join(root, "started");

    const result = spawnSync(
      script,
      [
        "--allow-no-earlyoom",
        "--min-mem-gb",
        "0",
        "--min-swap-gb",
        "0",
        option,
        value,
        "--",
        "sh",
        "-c",
        `touch ${JSON.stringify(marker)}`,
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
    expect(existsSync(marker)).toBe(false);
  });
});
