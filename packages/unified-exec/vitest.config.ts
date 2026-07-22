import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/collect.ts",
        "src/completion.ts",
        "src/constants.ts",
        "src/format-time.ts",
        "src/head-tail-buffer.ts",
        "src/long-wait.ts",
        "src/notify.ts",
        "src/session-store.ts",
        "src/shell.ts",
        "src/termination.ts",
        "src/time.ts",
        "src/tool-helpers.ts",
        "src/unescape.ts",
        "src/write-stdin.ts",
      ],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
