export default {
  mutate: [
    "queue-model.ts",
    "history-model.ts",
    "delivery-policy.ts",
    "submit-policy.ts",
    "message-text.ts",
    "widget-lines.ts",
    "window-state.ts",
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
