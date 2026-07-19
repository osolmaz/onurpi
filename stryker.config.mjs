export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: [
    "packages/turn-fold/fold-policy.ts",
    "packages/turn-fold/mode.ts",
    "packages/pi-tui-history-replay/history-replay.ts",
    "packages/pi-must-win/git-commit-trailers.ts",
    "packages/pi-must-win/features/commit-attribution.ts",
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
