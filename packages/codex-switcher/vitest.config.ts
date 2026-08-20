import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "account-manager.ts",
        "config.ts",
        "index.ts",
        "native-provider.ts",
        "private-file.ts",
        "router.ts",
        "usage-client.ts",
        "usage-policy.ts",
        "vault.ts",
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
