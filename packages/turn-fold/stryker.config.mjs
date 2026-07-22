export default {
  mutate: [
    "configuration.ts",
    "fold-policy.ts",
    "mode.ts",
    "transcript-window-adapter.ts",
    "transcript-windows.ts",
    "tool-padding.ts",
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
