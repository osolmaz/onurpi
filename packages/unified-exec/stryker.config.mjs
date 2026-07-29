export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/completion.ts",
    "src/format-time.ts",
    "src/head-tail-buffer.ts",
    "src/time.ts",
    "src/unescape.ts",
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
