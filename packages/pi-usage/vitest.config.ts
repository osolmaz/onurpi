import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/core.ts",
        "src/format.ts",
        "src/query.ts",
        "src/usage.ts",
        "src/providers/codex.ts",
        "src/providers/github-copilot.ts",
        "src/providers/openrouter.ts",
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
