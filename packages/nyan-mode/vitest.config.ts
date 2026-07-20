import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "src/image.ts",
        "src/layout.ts",
        "src/painter.ts",
        "src/png.ts",
        "src/progress.ts",
        "src/xpm.ts",
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
