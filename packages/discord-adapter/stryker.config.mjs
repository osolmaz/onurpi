export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: ["src/access.ts", "src/bridge.ts", "src/chunks.ts", "src/config.ts"],
  reporters: ["clear-text", "progress"],
  testRunner: "vitest",
  thresholds: {
    break: 85,
    high: 90,
    low: 85,
  },
  tsconfigFile: "tsconfig.json",
};
