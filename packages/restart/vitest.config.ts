import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: [
        "arguments.ts",
        "command.ts",
        "index.ts",
        "install-command.ts",
        "ipc-client.ts",
        "launcher.ts",
        "pi-process.ts",
        "protocol.ts",
        "recovery.ts",
        "session-header.ts",
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
