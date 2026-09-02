import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import { getBashParser } from "../src/bash-parser.ts";
import { classifyBash } from "../src/classifier.ts";

async function classifyRepeatedly(source: string, count: number): Promise<number> {
  const parser = await getBashParser();
  for (let index = 0; index < 100; index++) await classifyBash(source, process.env, parser);
  const startedAt = performance.now();
  for (let index = 0; index < count; index++) {
    await classifyBash(source, process.env, parser);
  }
  return performance.now() - startedAt;
}

describe("Bash classification performance", () => {
  it("keeps 10,000 warm short-command checks below the broad CI ceiling", async () => {
    expect(await classifyRepeatedly("printf '%s\\n' safe", 10_000)).toBeLessThan(5000);
  }, 15_000);

  it("keeps a warm 64 KiB corpus below the broad CI ceiling", async () => {
    const prefix = "printf '%s' '";
    const source = `${prefix}${"x".repeat(64 * 1024 - prefix.length - 1)}'`;
    expect(await classifyRepeatedly(source, 100)).toBeLessThan(5000);
  }, 15_000);
});
