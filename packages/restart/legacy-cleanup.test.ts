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
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { removeLegacyZshOverride, restoreLegacyPiBridge } from "./legacy-cleanup.ts";

const roots: string[] = [];
const block = `# >>> onurpi restart-aware pi >>>
unalias pi 2>/dev/null
function pi {
  "$HOME/.local/bin/pi" "$@"
}
# <<< onurpi restart-aware pi <<<
`;

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "onurpi-restart-cleanup-"));
  roots.push(root);
  return root;
}

function executable(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "#!/usr/bin/env node\n");
  chmodSync(path, 0o755);
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("restart override cleanup", () => {
  it("restores only a managed active Pi bridge", () => {
    const root = temporaryRoot();
    const launcher = executable(join(root, "checkout/packages/restart/bin/pi.ts"));
    const upstream = executable(join(root, "node/lib/pi/dist/cli.js"));
    const target = join(root, "node/bin/pi");
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(launcher, target);

    expect(restoreLegacyPiBridge(launcher, upstream, target, "linux")).toBe("restored");
    expect(resolve(dirname(target), readlinkSync(target))).toBe(upstream);
    expect(restoreLegacyPiBridge(launcher, upstream, target, "linux")).toBe("unchanged");
  });

  it("does not replace an unrelated active Pi command", () => {
    const root = temporaryRoot();
    const launcher = executable(join(root, "checkout/packages/restart/bin/pi.ts"));
    const upstream = executable(join(root, "node/lib/pi/dist/cli.js"));
    const unrelated = executable(join(root, "other/pi"));
    const target = join(root, "node/bin/pi");
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(unrelated, target);

    expect(restoreLegacyPiBridge(launcher, upstream, target, "linux")).toBe("unchanged");
    expect(resolve(dirname(target), readlinkSync(target))).toBe(unrelated);
  });

  it("removes only the exact managed Zsh block", () => {
    const home = temporaryRoot();
    const zshrc = join(home, ".zshrc");
    writeFileSync(zshrc, `before\n\n${block}after\n`);

    expect(removeLegacyZshOverride(home, "linux")).toBe("removed");
    expect(readFileSync(zshrc, "utf8")).toBe("before\nafter\n");
    expect(removeLegacyZshOverride(home, "linux")).toBe("unchanged");
  });

  it("preserves a symlinked Zsh configuration", () => {
    const home = temporaryRoot();
    const source = join(home, "dotfiles/zshrc");
    const zshrc = join(home, ".zshrc");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, block);
    symlinkSync(source, zshrc);

    expect(removeLegacyZshOverride(home, "linux")).toBe("removed");
    expect(lstatSync(zshrc).isSymbolicLink()).toBe(true);
    expect(readFileSync(source, "utf8")).toBe("");
  });
});
