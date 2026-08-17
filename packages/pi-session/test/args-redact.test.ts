import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/args.js";
import { boundedExcerpt } from "../src/redact.js";

describe("argument parsing", () => {
  it("uses bounded recovery defaults", () => {
    const command = parseArgs(["019fd7b1"]);
    expect(command).toMatchObject({
      kind: "show",
      session: "019fd7b1",
      options: {
        last: 20,
        assistant: "final",
        format: "text",
        allProjects: false,
      },
    });
    if (command.kind !== "show") throw new Error("expected show command");
    expect([...command.options.include]).toEqual(["workflow", "plan", "errors", "files"]);
  });

  it("parses show, list, entry, and help options", () => {
    expect(
      parseArgs([
        "abc",
        "--last",
        "3",
        "--assistant",
        "text",
        "--include",
        "workflow,errors",
        "--since",
        "entry1",
        "--format",
        "json",
        "--all-projects",
      ]),
    ).toMatchObject({ kind: "show", options: { last: 3, assistant: "text", format: "json" } });
    expect(parseArgs(["list", "--limit", "4", "--format", "json", "--all-projects"])).toEqual({
      kind: "list",
      limit: 4,
      format: "json",
      allProjects: true,
    });
    expect(parseArgs(["entry", "abc", "e1", "--format", "json", "--all-projects"])).toEqual({
      kind: "entry",
      session: "abc",
      entryId: "e1",
      format: "json",
      allProjects: true,
    });
    expect(parseArgs([])).toEqual({ kind: "help" });
    expect(parseArgs(["abc", "--include", "none"])).toMatchObject({
      kind: "show",
      options: { include: new Set() },
    });
  });

  it.each([
    [["abc", "--last", "0"], "--last must be a positive integer"],
    [["abc", "--last", "999999999999999999999"], "--last must be a positive integer"],
    [["abc", "--last", "--format", "json"], "--last requires a value"],
    [["abc", "--assistant", "all"], "--assistant must be one of"],
    [["abc", "--include", "workflow,raw"], "--include must be"],
    [["abc", "--format", "yaml"], "--format must be one of"],
    [["abc", "--last", "2", "--last", "3"], "duplicate option"],
    [["entry", "abc"], "usage: pi-session entry"],
    [["list", "extra"], "unexpected argument"],
    [["list", "--format"], "--format requires a value"],
    [["list", "--unknown", "x"], "unknown option"],
    [["list", "--all-projects", "extra"], "unexpected argument"],
    [["entry", "abc", "e1", "--unknown", "x"], "unknown option"],
    [["abc", "--since"], "--since requires a value"],
    [["abc", "--last", "not-a-number"], "--last must be a positive integer"],
    [["abc", "--unknown", "x"], "unknown option"],
  ])("rejects invalid arguments %#", (args, message) => {
    expect(() => parseArgs(args)).toThrow(message);
  });
});

describe("redaction and excerpt limits", () => {
  it("redacts narrow credential forms without changing normal text", () => {
    const excerpt = boundedExcerpt(
      'normal text Bearer abc.def api_key="secret-value" ghp_12345678901234567890',
      2_048,
    );
    expect(excerpt.text).toContain("normal text");
    expect(excerpt.text).toContain("Bearer <redacted>");
    expect(excerpt.text).not.toContain("secret-value");
    expect(excerpt.text).not.toContain("ghp_12345678901234567890");
    expect(excerpt.redactions).toBe(3);
  });

  it("omits base64, binary, and private-key payloads", () => {
    const excerpt = boundedExcerpt(
      `data:image/png;base64,${"A".repeat(500)}\0\0${"B".repeat(300)}-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----`,
      2_048,
    );
    expect(excerpt.text).toContain("[image base64 payload omitted]");
    expect(excerpt.text).toContain("[base64 payload omitted: 300 bytes]");
    expect(excerpt.text).toContain("[binary byte omitted]");
    expect(excerpt.text).toContain("[private key redacted]");
    expect(excerpt.omissions.join(" ")).toContain("image base64 payload");
    expect(excerpt.omissions).toContain("2 NUL bytes");
    expect(excerpt.redactions).toBe(1);
  });

  it("preserves assignment quote style and redacts OpenAI keys", () => {
    const excerpt = boundedExcerpt("password='secret-value' sk-1234567890_abcdef", 2_048);
    expect(excerpt.text).toContain("password='<redacted>'");
    expect(excerpt.text).not.toContain("secret-value");
    expect(excerpt.text).not.toContain("sk-1234567890_abcdef");
    expect(excerpt.redactions).toBe(2);
  });

  it("bounds omission notices from repeated encoded payloads", () => {
    const payloads = Array.from({ length: 30 }, () => "A".repeat(300)).join(" ");
    const excerpt = boundedExcerpt(payloads, 2_048);
    expect(excerpt.omissions).toHaveLength(21);
    expect(excerpt.omissions.at(-1)).toContain("more omission notices");
  });

  it("uses Pi byte truncation and reports the omitted size", () => {
    const excerpt = boundedExcerpt("line\n".repeat(1_000), 100);
    expect(excerpt.truncated).toBe(true);
    expect(excerpt.shownBytes).toBeLessThanOrEqual(100);
    expect(excerpt.omittedBytes).toBeGreaterThan(0);
  });

  it("keeps a byte-safe prefix from an oversized first line", () => {
    const excerpt = boundedExcerpt(`start-${"🙂".repeat(1_000)}`, 101);
    expect(excerpt.text).toMatch(/^start-/u);
    expect(excerpt.text).not.toContain("�");
    expect(excerpt.shownBytes).toBeLessThanOrEqual(101);
    expect(excerpt.truncated).toBe(true);
  });
});
