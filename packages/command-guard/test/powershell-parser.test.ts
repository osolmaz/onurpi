import { describe, expect, it } from "vitest";

import { classifyPowerShell } from "../src/classifier.ts";
import {
  decodePowerShellParseResult,
  type PowerShellParseResult,
  type PowerShellParser,
} from "../src/powershell-parser.ts";

function parser(result: PowerShellParseResult): PowerShellParser {
  return { parse: () => Promise.resolve(result) };
}

describe("PowerShell parser result", () => {
  it("validates bounded JSON syntax nodes", () => {
    expect(
      decodePowerShellParseResult(
        JSON.stringify({
          errors: [],
          commands: [
            {
              name: "Clear-Content",
              source: "Clear-Content file",
              elements: [
                {
                  kind: "StringConstantExpressionAst",
                  text: "Clear-Content",
                  value: "Clear-Content",
                },
                { kind: "StringConstantExpressionAst", text: "file", value: "file" },
              ],
            },
          ],
          redirects: [
            {
              source: "> file",
              destination: { kind: "StringConstantExpressionAst", text: "file", value: "file" },
            },
          ],
        }),
      ),
    ).toMatchObject({ commands: [{ name: "Clear-Content" }], redirects: [{ source: "> file" }] });
  });

  it("rejects malformed helper output", () => {
    expect(() => decodePowerShellParseResult("{}")).toThrow("invalid result");
    expect(() =>
      decodePowerShellParseResult(
        JSON.stringify({ errors: [], commands: [{ source: 1, elements: [] }], redirects: [] }),
      ),
    ).toThrow("invalid syntax nodes");
  });

  it("classifies aliases, clearing, and redirection", async () => {
    const result = await classifyPowerShell(
      "clc file; rm target; echo x > output",
      parser({
        errors: [],
        commands: [
          {
            name: "clc",
            source: "clc file",
            elements: [
              { kind: "StringConstantExpressionAst", text: "clc", value: "clc" },
              { kind: "StringConstantExpressionAst", text: "file", value: "file" },
            ],
          },
          {
            name: "rm",
            source: "rm target",
            elements: [
              { kind: "StringConstantExpressionAst", text: "rm", value: "rm" },
              { kind: "StringConstantExpressionAst", text: "target", value: "target" },
            ],
          },
        ],
        redirects: [
          {
            source: "> output",
            destination: { kind: "StringConstantExpressionAst", text: "output", value: "output" },
          },
        ],
      }),
    );
    expect(result.operations.map((item) => item.kind)).toEqual([
      "truncate",
      "recursive-delete",
      "truncate",
    ]);
  });

  it("skips the helper when no destructive token exists", async () => {
    let called = false;
    const safeParser: PowerShellParser = {
      parse: () => {
        called = true;
        return Promise.resolve({ errors: [], commands: [], redirects: [] });
      },
    };
    await expect(classifyPowerShell("Write-Output safe", safeParser)).resolves.toEqual({
      operations: [],
    });
    expect(called).toBe(false);
  });
});
