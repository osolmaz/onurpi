export default {
  mutate: [
    "codex-compaction.ts",
    "config.ts",
    "native-checkpoint.ts",
    "remote-compaction.ts",
    "responses-input.ts",
  ],
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
