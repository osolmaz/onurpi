import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.test.ts",
        "features/register-commit-attribution.ts",
        "index.ts",
        "vitest.config.ts",
      ],
      include: ["**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    include: ["**/*.test.ts"],
  },
});
