export default {
  mutate: [
    "configuration.ts",
    "edit-diff-stat.ts",
    "fold-policy.ts",
    "density.ts",
    "history-scope.ts",
    "projection-plan.ts",
    "run-boundary.ts",
    "transcript-window-adapter.ts",
    "transcript-windows.ts",
    "tool-padding.ts",
    "turn-visibility.ts",
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
