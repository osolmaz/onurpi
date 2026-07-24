import { describe, expect, it } from "vitest";

import { parseEditPatch } from "./edit-diff-stat.ts";

describe("edit diffstat parser", () => {
  it("counts replacements and patch-like added content inside a hunk", () => {
    expect(
      parseEditPatch(
        [
          "--- src/example.ts",
          "+++ src/example.ts",
          "@@ -1,2 +1,3 @@",
          "-old",
          "++++literal",
          "+---literal",
          " context",
          "",
        ].join("\n"),
      ),
    ).toEqual({ additions: 2, deletions: 1, path: "src/example.ts" });
  });

  it("adds counts from multiple hunks", () => {
    expect(
      parseEditPatch(
        [
          "--- src/example.ts",
          "+++ src/example.ts",
          "@@ -1,2 +1,2 @@",
          "-first",
          "+FIRST",
          " context",
          "@@ -10,1 +10,2 @@ section",
          " context",
          "+added",
          "",
        ].join("\n"),
      ),
    ).toEqual({ additions: 2, deletions: 1, path: "src/example.ts" });
  });

  it("supports pure insertions, pure deletions, CRLF, and timestamped headers", () => {
    expect(
      parseEditPatch(
        [
          "--- new file.ts\tbefore",
          "+++ new file.ts\tafter",
          "@@ -0,0 +1,2 @@",
          "+first",
          "+second",
          "",
        ].join("\r\n"),
      ),
    ).toEqual({ additions: 2, deletions: 0, path: "new file.ts" });
    expect(
      parseEditPatch(
        [
          "--- old.ts",
          "+++ old.ts",
          "@@ -1,2 +0,0 @@",
          "-first",
          "-second",
          "\\ No newline at end of file",
          "",
        ].join("\n"),
      ),
    ).toEqual({ additions: 0, deletions: 2, path: "old.ts" });
  });

  it.each([
    ["missing headers", "@@ -1 +1 @@\n-old\n+new\n"],
    ["different paths", "--- old.ts\n+++ new.ts\n@@ -1 +1 @@\n-old\n+new\n"],
    ["missing hunk", "--- file.ts\n+++ file.ts\n"],
    ["unchanged hunk", "--- file.ts\n+++ file.ts\n@@ -1 +1 @@\n same\n"],
    ["short hunk", "--- file.ts\n+++ file.ts\n@@ -1,2 +1,2 @@\n same\n"],
    ["long hunk", "--- file.ts\n+++ file.ts\n@@ -1 +1 @@\n same\n extra\n"],
    ["invalid body", "--- file.ts\n+++ file.ts\n@@ -1 +1 @@\n?bad\n"],
    [
      "unsafe line count",
      "--- file.ts\n+++ file.ts\n@@ -1,999999999999999999999 +1 @@\n-old\n+new\n",
    ],
  ])("rejects %s", (_description, patch) => {
    expect(parseEditPatch(patch)).toBeUndefined();
  });
});
