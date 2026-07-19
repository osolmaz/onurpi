export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: ["git-commit-trailers.ts", "features/commit-attribution.ts"],
  reporters: ["clear-text", "progress"],
  tempDirName: ".stryker-tmp",
  testRunner: "vitest",
  thresholds: {
    break: 85,
    high: 90,
    low: 85,
  },
  tsconfigFile: "tsconfig.json",
  vitest: {
    configFile: "vitest.config.ts",
  },
};
