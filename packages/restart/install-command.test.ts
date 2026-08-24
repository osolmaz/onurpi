import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installPiCommand } from "./install-command.ts";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "onurpi-restart-install-"));
  roots.push(root);
  return root;
}

function launcher(root: string, checkout: string): string {
  const source = join(root, checkout, "packages", "restart", "bin", "pi.ts");
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, "#!/usr/bin/env node\n");
  chmodSync(source, 0o755);
  return source;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("restart-aware pi command installer", () => {
  it("installs the launcher at the stable user command path", () => {
    const home = temporaryRoot();
    const source = launcher(home, "checkout");
    const result = installPiCommand(home, source, "linux");
    expect(result).toEqual({ status: "installed", target: join(home, ".local/bin/pi") });
    expect(lstatSync(result.target).isSymbolicLink()).toBe(true);
    expect(readlinkSync(result.target)).toBe(source);
    expect(installPiCommand(home, source, "linux")).toEqual({
      status: "current",
      target: result.target,
    });
  });

  it("updates a managed launcher link from another checkout", () => {
    const home = temporaryRoot();
    const target = join(home, ".local/bin/pi");
    const oldSource = join(home, "old", "packages", "restart", "bin", "pi.ts");
    const source = launcher(home, "new");
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(oldSource, target, "file");

    expect(installPiCommand(home, source, "linux").status).toBe("installed");
    expect(readlinkSync(target)).toBe(source);
  });

  it("refuses to replace an unmanaged command", () => {
    const home = temporaryRoot();
    const target = join(home, ".local/bin/pi");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, "unmanaged");

    const source = launcher(home, "checkout");
    expect(() => installPiCommand(home, source, "linux")).toThrow(/unmanaged command/u);
  });

  it("does not install on an untested platform", () => {
    const home = temporaryRoot();
    expect(installPiCommand(home, "/checkout/packages/restart/bin/pi.ts", "darwin")).toEqual({
      status: "unsupported",
      target: join(home, ".local/bin/pi"),
    });
  });
});
