export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: ["src/config.ts", "src/mounts.ts"],
  reporters: ["clear-text", "progress"],
  testRunner: "vitest",
  thresholds: {
    break: 85,
    high: 90,
    low: 85,
  },
  tsconfigFile: "tsconfig.json",
};
