import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "packages/turn-fold/fold-policy.ts",
        "packages/turn-fold/mode.ts",
        "packages/turn-fold/turn-state.ts",
        "packages/turn-fold/tool-padding.ts",
        "packages/pi-tui-history-replay/history-replay.ts",
        "packages/live-stats/live-stats.ts",
        "packages/live-stats/working-phrases.ts",
        "packages/nyan-mode/src/cost.ts",
        "packages/nyan-mode/src/image.ts",
        "packages/nyan-mode/src/kitty-probe.ts",
        "packages/nyan-mode/src/layout.ts",
        "packages/nyan-mode/src/painter.ts",
        "packages/nyan-mode/src/png.ts",
        "packages/nyan-mode/src/progress.ts",
        "packages/nyan-mode/src/rainbow.ts",
        "packages/nyan-mode/src/xpm.ts",
        "packages/prompt-queue/queue-model.ts",
        "packages/prompt-queue/history-model.ts",
        "packages/prompt-queue/delivery-policy.ts",
        "packages/prompt-queue/submit-policy.ts",
        "packages/prompt-queue/message-text.ts",
        "packages/prompt-queue/widget-lines.ts",
        "packages/prompt-queue/window-state.ts",
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
