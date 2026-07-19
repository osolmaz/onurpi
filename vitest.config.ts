import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "packages/turn-fold/fold-policy.ts",
        "packages/turn-fold/mode.ts",
        "packages/turn-fold/turn-state.ts",
        "packages/pi-tui-history-replay/history-replay.ts",
      ],
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    include: ["packages/**/*.test.ts"],
  },
});
