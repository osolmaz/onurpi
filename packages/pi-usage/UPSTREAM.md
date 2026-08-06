# Upstream provenance

- Repository: https://github.com/narumiruna/pi-extensions
- Directory: `extensions/pi-usage`
- Commit: `ce66737cc3222383529c1f3fd712828bd58239a9` (identical tree to the `v0.49.4` release commit
  `229d528b36c4012b542caae5f4cfbe27365a2d17` for this directory)
- Retrieved: 2026-08-06
- Upstream package: `@narumitw/pi-usage@0.49.4`
- License: MIT

## Reviewed contents

The review covered the package manifest, README, license, TypeScript configuration, every source
file under `src/` (including `src/providers/`), and every test file under `test/`.

The extension executes no shell commands and installs no shell hooks. It reads no files. It sends
GET requests only to the fixed `https://chatgpt.com/backend-api/wham/usage`,
`https://api.github.com/copilot_internal/user`, and `https://openrouter.ai/api/v1/key` endpoints
with bounded response reads (64 KiB success, 4 KiB error) and 15-second timeouts. Credentials are
resolved through Pi's public model registry and credential APIs; custom-base-URL, proxy, GitHub
Enterprise, and account-mismatched credentials fail closed and are never forwarded. Error text is
redacted of bearer tokens and credential material. The extension sends no telemetry, overrides no
tools, and handles no project trust decisions. Its five-minute cache and failure backoff live in
process memory and are keyed by a process-salted credential HMAC.

The interactive `/usage` menu runs on `@narumitw/pi-tui-kit`, vendored separately as
`@onurpi/pi-tui-kit` (see `packages/pi-tui-kit/UPSTREAM.md`).

## Local changes

- Renamed the private package to `@onurpi/pi-usage` and added the repository-standard root entry
  point (`index.ts`) and quality configuration (eslint, prettier, strict TypeScript, vitest,
  slophammer). Upstream sources and tests are reformatted to the repository Prettier style.
- Removed upstream publishing and repository-maintenance machinery: npm publish metadata (`files`,
  `private: false`, keywords) and the biome tooling.
- Replaced the upstream runtime dependency `@narumitw/pi-tui-kit` with the vendored workspace
  package `@onurpi/pi-tui-kit`; only the two dynamic import specifiers in `src/usage.ts` changed.
- Kept the OnurPi status policy from the retired codex-usage package: the `usage` status has no
  polling timer. Upstream additionally re-queries the current provider every five minutes via
  `setTimeout`; here the status refreshes only from Pi lifecycle hooks (`session_start`,
  `session_tree`, `model_select`, `turn_start`) and from `/usage` menu actions, with the shared
  five-minute in-memory cache still bounding query frequency. The status remains gated on the
  selected model's provider and is cleared for unsupported providers, as upstream. Difference from
  upstream: status values can be up to one lifecycle event older than upstream's five-minute re-poll
  when a session idles without turns.
- Declared optional properties that receive explicit `undefined` as `| undefined` and used index
  access for provider payload fields, as required by the repository's `exactOptionalPropertyTypes`
  and `noPropertyAccessFromIndexSignature` settings. Type-level adjustments; no runtime behavior
  change.
- Added line-level, justified eslint suppressions for audited upstream routines that exceed the
  repository complexity and function-length limits; no logic was restructured.
- Ported the upstream `node:test` suite to Vitest (runner import swap, `onTestFinished` for
  `t.after`) and ported the shared monorepo mock harness to `test/support.ts`.
- Added `test/local-coverage.test.ts` covering generic report rendering, statusline variants for all
  three providers, Codex model-bucket selection, and Codex payload normalization edge cases.
