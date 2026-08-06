import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/custom-interaction.ts",
        "src/interaction.ts",
        "src/model.ts",
        "src/navigator.ts",
        "src/runtime.ts",
        "src/task.ts",
        "src/components/rendering.ts",
        "src/components/review.ts",
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
