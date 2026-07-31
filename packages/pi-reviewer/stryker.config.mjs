export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/args.ts",
    "src/config.ts",
    "src/git-target.ts",
    "src/pi-events.ts",
    "src/review-output.ts",
    "extensions/shell-policy.ts",
  ],
  reporters: ["clear-text", "progress"],
  testRunner: "vitest",
  thresholds: {
    break: 85,
    high: 90,
    low: 85,
  },
  tsconfigFile: "tsconfig.json",
};
