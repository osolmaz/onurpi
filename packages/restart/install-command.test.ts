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

import { installActivePiBridge, installPiCommand, installZshOverride } from "./install-command.ts";

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

  it("bridges the active managed Pi command for an already-running shell", () => {
    const root = temporaryRoot();
    const source = launcher(root, "checkout");
    const upstream = join(root, "upstream", "dist", "cli.js");
    const target = join(root, "node", "bin", "pi");
    mkdirSync(dirname(upstream), { recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(upstream, "#!/usr/bin/env node\n");
    chmodSync(upstream, 0o755);
    symlinkSync(upstream, target);

    expect(installActivePiBridge(source, upstream, target, "linux")).toEqual({
      status: "installed",
      target,
    });
    expect(readlinkSync(target)).toBe(source);
    expect(installActivePiBridge(source, upstream, target, "linux").status).toBe("current");
  });

  it("updates an active bridge from an older managed checkout", () => {
    const root = temporaryRoot();
    const source = launcher(root, "new");
    const oldSource = launcher(root, "old");
    const upstream = launcher(root, "upstream");
    const target = join(root, "node", "bin", "pi");
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(oldSource, target);

    expect(installActivePiBridge(source, upstream, target, "linux").status).toBe("installed");
    expect(readlinkSync(target)).toBe(source);
  });

  it("does not replace an unrelated active Pi command", () => {
    const root = temporaryRoot();
    const source = launcher(root, "checkout");
    const upstream = launcher(root, "upstream");
    const unrelated = join(root, "unrelated", "pi");
    const target = join(root, "node", "bin", "pi");
    mkdirSync(dirname(unrelated), { recursive: true });
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(unrelated, "#!/usr/bin/env node\n");
    chmodSync(unrelated, 0o755);
    symlinkSync(unrelated, target);

    expect(installActivePiBridge(source, upstream, target, "linux")).toEqual({
      status: "unsupported",
      target,
    });
    expect(readlinkSync(target)).toBe(unrelated);
  });
});

describe("restart-aware Zsh override", () => {
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

  it("updates a symlinked Zsh configuration without replacing the symlink", () => {
    const home = temporaryRoot();
    const dotfiles = join(home, "dotfiles");
    const zshrc = join(home, ".zshrc");
    const source = join(dotfiles, "zshrc");
    mkdirSync(dotfiles, { recursive: true });
    writeFileSync(source, "before\n");
    symlinkSync(source, zshrc);

    expect(installZshOverride(home, "zsh", "linux").status).toBe("installed");
    expect(lstatSync(zshrc).isSymbolicLink()).toBe(true);
    expect(readFileSync(source, "utf8")).toContain("# >>> onurpi restart-aware pi >>>");
  });

  it("refuses a dangling Zsh configuration symlink without replacing it", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    const missing = join(home, "missing", "zshrc");
    symlinkSync(missing, zshrc);

    expect(() => installZshOverride(home, "zsh", "linux")).toThrow(/dangling/u);
    expect(lstatSync(zshrc).isSymbolicLink()).toBe(true);
    expect(readlinkSync(zshrc)).toBe(missing);
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

  it("refuses malformed or duplicate blocks and skips unsupported environments", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    writeFileSync(zshrc, "# >>> onurpi restart-aware pi >>>\n");
    expect(() => installZshOverride(home, "zsh", "linux")).toThrow(/malformed/u);

    writeFileSync(
      zshrc,
      [
        "# >>> onurpi restart-aware pi >>>",
        "# <<< onurpi restart-aware pi <<<",
        "# >>> onurpi restart-aware pi >>>",
        "# <<< onurpi restart-aware pi <<<",
        "",
      ].join("\n"),
    );
    expect(() => installZshOverride(home, "zsh", "linux")).toThrow(/duplicate/u);
    expect(installZshOverride(home, "/bin/bash", "linux").status).toBe("unsupported");
    expect(installZshOverride(home, "/bin/zsh", "darwin").status).toBe("unsupported");
  });
});

describe("restart installer platform boundary", () => {
  it("does not install the command on an untested platform", () => {
    const home = temporaryRoot();
    expect(installPiCommand(home, "/checkout/packages/restart/bin/pi.ts", "darwin")).toEqual({
      status: "unsupported",
      target: join(home, ".local/bin/pi"),
    });
  });
});
