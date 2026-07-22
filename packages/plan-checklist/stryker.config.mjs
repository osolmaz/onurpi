export default {
  mutate: [
    "plan-context.ts",
    "plan-render.ts",
    "plan-replay.ts",
    "plan-schema.ts",
    "plan-state.ts",
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
