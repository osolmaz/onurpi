# Upstream provenance

- Repository: https://github.com/tornikegomareli/pi-nyan-mode
- Commit: `7e47605c37fbb143b379ae39305dc36810c6566b`
- Retrieved: 2026-07-20
- Upstream package version: `0.1.0`
- License: GPL-3.0-or-later
- Original artwork: https://github.com/TeMPOraL/nyan-mode, GPL-3.0-or-later

## Reviewed contents

The review covered the upstream package manifest, README, license and notice files; `extensions/nyan-footer.ts`; every file under `src/`; the custom-statusline example; and all bundled XPM assets and their copied license.

The extension executes no processes, installs no shell hooks, accesses no credentials, sends no telemetry, performs no network requests, intercepts no provider traffic, overrides no tools, and handles no project-trust decisions. Runtime filesystem access is limited to reading the bundled XPM files. Its only background resource is an animation timer created by the session footer painter and stopped during footer disposal. Kitty image sequences are returned through Pi's footer renderer rather than written to absolute terminal coordinates.

## Local changes

- Renamed the private workspace package to `@onurpi/nyan-mode` and converted it to the repository's ESM and explicit TypeScript-import conventions.
- Registered the extension through a root `index.ts` entry point.
- Added strict input validation, bounded caches, tests, coverage, mutation testing, and Slophammer configuration.
- Split pure layout and image logic from Pi event wiring.
- Rendered images inline through Pi's differential renderer so startup and resize redraws own image placement and cleanup.
- Added a fixed-width ANSI kaomoji with a smooth full-height rainbow and a duration-, tool-, and error-aware mood state machine for Mosh and other transports without Kitty graphics support, with text mode as the default.
- Removed upstream examples and the deprecated static renderer because the requested capability is the drop-in animated footer.
- Preserved the bitmap-only behavior, six original animation frames, smooth movement, Kitty capability check, `/nyan` commands, GPL license, notice, and original artwork licenses while making runway position represent remaining context instead of used context.
- Added inline rendering for OnurPi's namespaced Codex weekly-remaining status after the subscription marker while leaving other extension statuses on the secondary line.
