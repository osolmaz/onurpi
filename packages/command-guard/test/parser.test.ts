import { describe, expect, it } from "vitest";

import { getBashParser } from "../src/bash-parser.ts";
import { MAX_PARSED_COMMANDS } from "../src/limits.ts";

describe("Bash parser", () => {
  it("resolves fixed environment variables and records references", async () => {
    const parser = await getBashParser();
    const script = parser.parse('rm -f "$TARGET/file"', { TARGET: "/tmp/root" });
    expect(script.commands[0]?.args.at(-1)).toEqual({
      raw: '"$TARGET/file"',
      value: "/tmp/root/file",
      referencedVariables: ["TARGET"],
    });
  });

  it("marks assigned, read, unset, and complex variables as uncertain", async () => {
    const parser = await getBashParser();
    const cases = [
      'TARGET=x; rm -f "$TARGET"',
      'read TARGET; rm -f "$TARGET"',
      'unset TARGET; rm -f "$TARGET"',
      'rm -f "${TARGET:-fallback}"',
      "rm -f $1",
      "rm -f `printf target`",
      "rm -f ~/target",
    ];
    for (const source of cases) {
      const script = parser.parse(source, { TARGET: "/tmp/value" });
      const rm = script.commands.find((command) => command.name.value === "rm");
      expect(rm?.args.at(-1)?.value, source).toBeUndefined();
    }
  });

  it("fails closed for missing variables and malformed words", async () => {
    const parser = await getBashParser();
    const missing = parser.parse('rm -f "$MISSING"', {});
    expect(missing.commands[0]?.args.at(-1)?.reason).toContain("is not set");
    const trailing = parser.parse("rm -f target\\", {});
    expect(trailing.hasError).toBe(true);
    const quoted = parser.parse("rm -f 'literal*'", {});
    expect(quoted.commands[0]?.args.at(-1)?.value).toBe("literal*");
  });

  it("preserves backslashes that Bash keeps inside double quotes", async () => {
    const parser = await getBashParser();
    const doubleQuotedBackslash = parser.parse('rm -f "child\\q"', {});
    expect(doubleQuotedBackslash.commands[0]?.args.at(-1)?.value).toBe("child\\q");
  });

  it("extracts truncating redirections", async () => {
    const parser = await getBashParser();
    const script = parser.parse(": 2>| output", {});
    expect(script.redirects[0]).toMatchObject({ operator: ">|" });
  });

  it("reuses and can reset the process parser", async () => {
    const first = await getBashParser();
    expect(await getBashParser()).toBe(first);
    const { resetBashParserForTests } = await import("../src/bash-parser.ts");
    resetBashParserForTests();
    expect(await getBashParser()).not.toBe(first);
  });

  it("enforces the extracted command count", async () => {
    const parser = await getBashParser();
    const source = "true;".repeat(MAX_PARSED_COMMANDS + 1);
    expect(() => parser.parse(source, {})).toThrow("command count exceeds safety limit");
  });
});
