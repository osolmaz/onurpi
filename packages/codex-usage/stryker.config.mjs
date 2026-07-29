export default {
  mutate: ["src/codex-usage.ts", "src/format.ts", "src/normalize.ts"],
  testRunner: "vitest",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  coverageAnalysis: "perTest",
  thresholds: {
    high: 90,
    low: 85,
    break: 85,
  },
  reporters: ["clear-text", "progress"],
  tempDirName: ".stryker-tmp",
  vitest: {
    configFile: "vitest.config.ts",
  },
};
