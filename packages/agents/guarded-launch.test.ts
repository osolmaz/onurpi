import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];
const script = join(
  import.meta.dirname,
  "skills",
  "safe-inference-launch",
  "scripts",
  "guarded-launch.sh",
);

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "onurpi-guarded-launch-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { force: true, recursive: true });
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
