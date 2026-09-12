export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: ["src/claudishlint/index.ts", "src/claudishlint/rules.ts"],
  reporters: ["clear-text", "progress"],
  testRunner: "vitest",
  thresholds: {
    break: 85,
    high: 90,
    low: 85,
  },
  tsconfigFile: "tsconfig.json",
};
