import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { classifyNonBash } from "../src/classifier.ts";
import { commandContext } from "../src/contexts.ts";
import { isRawStoragePath } from "../src/path-policy.ts";
import { evaluateCommand } from "../src/policy.ts";

let directory = "";
let imagePath = "";

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "command-guard-storage-"));
  imagePath = join(directory, "disk.img");
  writeFileSync(imagePath, "image");
});

function bash(command: string, environment: NodeJS.ProcessEnv = process.env) {
  return evaluateCommand(commandContext({ command, cwd: directory, environment, shell: "bash" }));
}

describe("storage command policy", () => {
  it.each([
    "dd if=/dev/zero of=/dev/sda",
    "command dd if=/dev/zero of=/dev/nvme0n1",
    "mkfs.ext4 /dev/sda1",
    "busybox mkfs.xfs /dev/vda",
    "mke2fs /dev/mapper/root",
    "newfs_apfs /dev/disk2s1",
    "wipefs --all /dev/sdb",
    "wipefs --offset 0x438 /dev/sdb",
    "blkdiscard /dev/nvme0n1",
  ])("denies raw storage targets: %s", async (command) => {
    await expect(bash(command)).resolves.toEqual({
      action: "deny",
      reason: "refusing destructive target: raw storage device",
    });
  });

  it.each([
    "diskutil eraseDisk APFS Empty disk2",
    "diskutil eraseVolume APFS Empty disk2s1",
    "diskutil partitionDisk disk2 GPT APFS Volume 100%",
    "diskutil zeroDisk disk2",
    "diskutil randomDisk 2 disk2",
    "diskutil secureErase 0 disk2",
    "diskutil resetFusion",
    "diskutil apfs deleteContainer disk2",
    "diskutil apfs deleteVolume disk2s1",
    "diskutil apfs eraseContainer disk2",
  ])("denies destructive diskutil operations: %s", async (command) => {
    const decision = await bash(command);
    expect(decision.action).toBe("deny");
    if (decision.action !== "deny") throw new Error(`expected deny: ${command}`);
    expect(decision.reason).toContain("can erase storage");
  });

  it("allows storage commands that target regular files", async () => {
    for (const command of [
      `dd if=/dev/zero of=${imagePath}`,
      `mkfs.ext4 ${imagePath}`,
      `mke2fs ${imagePath} 1024`,
      `newfs_apfs ${imagePath}`,
      `wipefs --all ${imagePath}`,
      `blkdiscard ${imagePath}`,
    ]) {
      const decision = await bash(command);
      expect(decision.action, command).toBe("allow");
      if (decision.action !== "allow") throw new Error(`expected allow: ${command}`);
      expect(decision.operations[0]?.kind, command).toBe("device-write");
      expect(decision.targets[0]?.canonicalPath, command).toBe(imagePath);
    }
  });

  it("allows safe device endpoints and read-only disk inspection", async () => {
    await expect(bash("dd if=/dev/zero of=/dev/null")).resolves.toMatchObject({ action: "allow" });
    await expect(bash(`wipefs ${imagePath}`)).resolves.toMatchObject({
      action: "allow",
      operations: [],
    });
    await expect(bash("diskutil list")).resolves.toMatchObject({
      action: "allow",
      operations: [],
    });
    await expect(bash("diskutil apfs list")).resolves.toMatchObject({
      action: "allow",
      operations: [],
    });
  });

  it("blocks storage commands when their target or subcommand is unclear", async () => {
    await expect(bash("sudo dd if=/dev/zero of=/dev/nvme0n1")).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(
      bash('mkfs.ext4 "$TARGET"', { ...process.env, TARGET: undefined }),
    ).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(
      bash('dd "$ARGUMENTS"', { ...process.env, ARGUMENTS: undefined }),
    ).resolves.toMatchObject({
      action: "rewrite",
    });
    await expect(bash("xargs mkfs.ext4")).resolves.toEqual({
      action: "rewrite",
      reason: "mkfs.ext4 has no exact target",
    });
    await expect(
      bash('diskutil "$ACTION"', { ...process.env, ACTION: undefined }),
    ).resolves.toEqual({
      action: "rewrite",
      reason: "diskutil subcommand is not fixed",
    });
    await expect(bash(`mkfs.ext4 ${imagePath} --label volume`)).resolves.toEqual({
      action: "rewrite",
      reason: "storage options after a target cannot be checked",
    });
    expect(classifyNonBash(String.raw`mkfs.ext4 \\.\PhysicalDrive0`, "cmd")).toMatchObject({
      uncertainReason: "possible destructive cmd command is unsupported",
    });
  });

  it("recognizes common Unix and Windows raw storage paths without matching safe devices", () => {
    for (const target of [
      "/dev/sda",
      "/dev/nvme0n1p2",
      "/dev/mapper/root",
      "/dev/disk/by-id/example",
      "/dev/rdisk3s1",
      String.raw`\\.\PhysicalDrive0`,
      String.raw`\\.\C:`,
      String.raw`\\?\Volume{1234}`,
    ]) {
      expect(isRawStoragePath(target), target).toBe(true);
    }
    expect(isRawStoragePath("/dev/null")).toBe(false);
    expect(isRawStoragePath("/dev/stdout")).toBe(false);
    expect(isRawStoragePath(imagePath)).toBe(false);
  });
});
