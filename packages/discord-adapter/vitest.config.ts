import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      include: ["src/**/*.ts"],
      // The discord.js connection and the type-only module are checked by the live test and tsc.
      exclude: ["src/discordjs.ts", "src/index.ts", "src/types.ts"],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
