import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["*.ts"],
      exclude: ["*.test.ts", "index.ts", "vitest.config.ts"],
      thresholds: {
        statements: 85,
        branches: 85,
        functions: 85,
        lines: 85,
      },
    },
  },
});
