import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { createNyanRunwayPainter, renderAnimatedNyanRunway } from "pi-nyan-mode";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const nyan = createNyanRunwayPainter(tui);

      return {
        dispose() {
          nyan.dispose();
        },
        invalidate() {},
        render(width: number): string[] {
          const percent = ctx.getContextUsage()?.percent;
          const left = theme.fg("accent", "π ") + (footerData.getGitBranch() ?? "no-git");
          const right = theme.fg("muted", ctx.model?.id ?? "no-model");
          const trackWidth = width - visibleWidth(left) - visibleWidth(right) - 2;
          const startColumn = visibleWidth(left) + 2;
          const runway = renderAnimatedNyanRunway(nyan, { percent, cells: trackWidth, startColumn });

          if (!runway) {
            const padding = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
            return [truncateToWidth(left + padding + right, width, "")];
          }

          return [`${left} ${runway} ${right}`];
        },
      };
    });
  });
}
