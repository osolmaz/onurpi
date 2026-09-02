import { describe, expect, it } from "vitest";

import { resolveCommandShell } from "../src/command-shell.ts";
import { IS_WINDOWS, resolveDefaultShell } from "../src/shell.ts";

describe("public command shell resolution", () => {
  it("matches Unified Exec default shell selection", () => {
    expect(resolveCommandShell(undefined)).toBe(resolveDefaultShell().shell);
  });

  it("preserves an explicit POSIX shell", () => {
    if (!IS_WINDOWS) expect(resolveCommandShell("/bin/sh")).toBe("/bin/sh");
  });
});
