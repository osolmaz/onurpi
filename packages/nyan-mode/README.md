# pi-nyan-mode

Nyan Mode for [Pi](https://pi.dev), an animated bitmap Nyan Cat context runway for custom footers.

<img width="800" height="63" alt="CleanShot 2026-05-09 at 13 07 06" src="https://github.com/user-attachments/assets/961fcac3-7c0a-4636-90c9-68c9b94c3de8" />

## What it does

Classic [Emacs Nyan Mode](https://github.com/TeMPOraL/nyan-mode) but in Pi, In Emacs nyan uses the mode-line as an analog position indicator:

```text
buffer start ───────────────> buffer end
point 0%                       point 100%
```

Pi does not have a single buffer point, so this package maps the same idea to the agent-native axis that matters

```text
empty context ───────────────> full context / compaction
0%                              100%
```

The Nyan Cat moves left to right as the active model context fills. After compaction or a new session, it returns toward the left.

- Smooth animated bitmap Nyan Cat using Kitty graphics.
- Original XPM art and frames from `TeMPOraL/nyan-mode`.
- Imperative painter API that avoids Pi footer rerender flicker/ghosting.
- Drop-in Pi footer extension for immediate use.
- Reusable `createNyanRunwayPainter()` helper for custom statuslines.

## Terminal support

This package currently targets terminals that expose the Kitty graphics protocol

Pi disables image protocols inside `tmux`/`screen` by default because passthrough is unreliable. If `/nyan debug` reports `imageProtocol=none`, run Pi directly in Ghostty/Kitty/WezTerm or configure image passthrough yourself.

## Install

```bash
pi install git:github.com/tornikegomareli/pi-nyan-mode
```

## Drop-in footer

Installing the package loads `extensions/nyan-footer.ts`, which replaces Pi's footer with a Nyan context runway.

Commands:

```text
/nyan          toggle Nyan on/off
/nyan on       enable
/nyan off      disable
/nyan bitmap   enable bitmap mode (same as on; kept for muscle memory)
/nyan debug    show image protocol, asset status, and painter state
```

## Use inside your own statusline

Pi only has one active footer. If you already have a custom footer, do not load the drop-in footer. Instead, use the animated painter from your own extension.

Example:

```ts
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
          const cells = width - visibleWidth(left) - visibleWidth(right) - 2;
          const startColumn = visibleWidth(left) + 2;
          const runway = renderAnimatedNyanRunway(nyan, { percent, cells, startColumn });

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
```

`renderAnimatedNyanRunway()` returns spaces only. The painter draws the bitmap after Pi renders the footer, then updates the image directly with terminal writes. This avoids the flicker caused by embedding a new Kitty image in every footer render.

If your custom statusline lives in another package, add `pi-nyan-mode` as a dependency and import it as shown above. If you are using a loose local extension file, the most reliable option is to copy/vendor this package next to your extension and import it by path until the package is installed globally.

## Package filtering

If you want to install the package but not load its drop-in footer, filter extensions out in Pi settings:

```json
{
  "packages": [
    {
      "source": "git:github.com/tornikegomareli/pi-nyan-mode",
      "extensions": []
    }
  ]
}
```

Then your own package/extension can use the painter helper without the bundled footer taking over.

## API

### `createNyanRunwayPainter(tui, options?)`

Creates an animated painter bound to the current Pi TUI instance.

```ts
const painter = createNyanRunwayPainter(tui, {
  frameIntervalMs: 100,
  progressEase: 0.28,
  assetDir: "/custom/assets",
});
```

Call `painter.dispose()` from your footer component's `dispose()` method.

### `renderAnimatedNyanRunway(painter, options)`

```ts
renderAnimatedNyanRunway(painter, {
  percent,       // number | null | undefined, expected 0-100
  cells,         // terminal-cell width reserved for the runway
  startColumn,   // one-based terminal column for image placement
})
```

Returns a string of reserved spaces, or `undefined` when bitmap rendering is unavailable. It also updates the painter target, so call it during footer `render()`.

## Credits and license

This package includes XPM artwork from [TeMPOraL/nyan-mode](https://github.com/TeMPOraL/nyan-mode), licensed under GPL-3.0-or-later.

This package is licensed GPL-3.0-or-later. See [`LICENSE`](LICENSE), [`NOTICE`](NOTICE), and [`assets/nyan-mode/LICENSE`](assets/nyan-mode/LICENSE).
