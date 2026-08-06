# Upstream provenance

- Repository: https://github.com/narumiruna/pi-extensions
- Directory: `packages/pi-tui-kit`
- Commit: `ce66737cc3222383529c1f3fd712828bd58239a9` (identical tree to the `v0.49.4` release commit
  `229d528b36c4012b542caae5f4cfbe27365a2d17` for this directory)
- Retrieved: 2026-08-06
- Upstream package: `@narumitw/pi-tui-kit@0.49.4` (latest published npm release at retrieval:
  `0.49.3`)
- License: MIT

## Reviewed contents

The review covered the package manifest, README, license, TypeScript configuration, every source
file under `src/` (including `src/components/` and `src/testing/`), and every test file under
`test/`. The published npm tarball for `0.49.3` was also inspected: its `dist/` build contains no
process execution, shell hooks, filesystem writes, or network access, and its only runtime
dependency is `highlight.js@11.11.1`.

The library composes public Pi TUI primitives and the theme and keybindings injected by Pi's UI
callbacks. It keeps its Pi Coding Agent imports type-only, sends no telemetry, reads no files, and
creates no background resources; the only timers are the TUI loader animations owned by Pi TUI
components that are disposed with their screens.

## Local changes

- Renamed the private package to `@onurpi/pi-tui-kit` and added the repository-standard quality
  configuration (eslint, prettier, strict TypeScript, vitest, slophammer). Upstream sources and
  tests are reformatted to the repository Prettier style.
- Removed upstream publishing and repository-maintenance machinery: the `dist/` build script
  (`scripts/build.mjs`), `tsconfig.build.json`, the npm `files`/`main`/`types` publish metadata, and
  the biome tooling. The package exports its TypeScript sources directly (`"."` → `./src/index.ts`,
  `"./testing"` → `./src/testing/index.ts`).
- Declared optional properties that receive explicit `undefined` as `| undefined` and used index
  access where the repository's `exactOptionalPropertyTypes` and
  `noPropertyAccessFromIndexSignature` settings require it. Type-only adjustments; no runtime
  behavior change.
- Added line-level, justified eslint suppressions for audited upstream routines that exceed the
  repository complexity and function-length limits; no logic was restructured.
- Replaced the packaging-oriented `test/testing-exports.test.ts` (which built and resolved the npm
  `dist/` layout) with a source-level export-surface test; the asserted surface is unchanged.
- Ported the upstream `node:test` suite to Vitest (runner import swap only) and ported the shared
  monorepo mock harness to `test/support.ts`.
- Added `test/local-boundaries.test.ts` covering menu validation, navigator state, terminal-control
  sanitization, and non-TUI task lifecycle outcomes.
- Coverage is gated on the logic modules (`model`, `navigator`, `interaction`, `runtime`, `task`,
  `custom-interaction`, `rendering`, `review`); pure TUI component rendering and the test harnesses
  are excluded from the gate, mirroring the repository's unified-exec convention.
- `highlight.js@11.11.1` remains the single pinned runtime dependency.
