import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { installPiCommand, installZshOverride } from "./install-command.ts";

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

  it("installs an idempotent Zsh function that bypasses cached command paths", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    writeFileSync(zshrc, 'export PATH="$HOME/.local/bin:$PATH"\n');

    expect(installZshOverride(home, "/usr/bin/zsh", "linux")).toEqual({
      status: "installed",
      target: zshrc,
    });
    expect(readFileSync(zshrc, "utf8")).toBe(
      [
        'export PATH="$HOME/.local/bin:$PATH"',
        "",
        "# >>> onurpi restart-aware pi >>>",
        "unalias pi 2>/dev/null",
        "function pi {",
        '  "$HOME/.local/bin/pi" "$@"',
        "}",
        "# <<< onurpi restart-aware pi <<<",
        "",
      ].join("\n"),
    );
    expect(installZshOverride(home, "/usr/bin/zsh", "linux").status).toBe("current");
  });

  it("repairs its managed Zsh block without changing surrounding configuration", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    writeFileSync(
      zshrc,
      [
        "before",
        "# >>> onurpi restart-aware pi >>>",
        "old command",
        "# <<< onurpi restart-aware pi <<<",
        "after",
        "",
      ].join("\n"),
    );

    expect(installZshOverride(home, "zsh", "linux").status).toBe("installed");
    const result = readFileSync(zshrc, "utf8");
    expect(result).toMatch(/^before\n/u);
    expect(result).toMatch(/\n# <<< onurpi restart-aware pi <<<\nafter\n$/u);
    expect(result).toContain('"$HOME/.local/bin/pi" "$@"');
  });

  it("refuses malformed blocks and skips unsupported shells and platforms", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    writeFileSync(zshrc, "# >>> onurpi restart-aware pi >>>\n");
    expect(() => installZshOverride(home, "zsh", "linux")).toThrow(/malformed/u);
    expect(installZshOverride(home, "/bin/bash", "linux").status).toBe("unsupported");
    expect(installZshOverride(home, "/bin/zsh", "darwin").status).toBe("unsupported");
  });

  it("does not install the command on an untested platform", () => {
    const home = temporaryRoot();
    expect(installPiCommand(home, "/checkout/packages/restart/bin/pi.ts", "darwin")).toEqual({
      status: "unsupported",
      target: join(home, ".local/bin/pi"),
    });
  });
});
