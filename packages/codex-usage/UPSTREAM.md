# Upstream provenance

- Repository: https://github.com/narumiruna/pi-extensions
- Directory: `extensions/pi-codex-usage`
- Commit: `befd5684a7f4d861a9909b24f0723ee671029b1e`
- Retrieved: 2026-07-23
- Upstream package: `@narumitw/pi-codex-usage@0.20.0`
- npm integrity:
  `sha512-4ybvHG+CX6OZ452bMDN4+EvunI3Kv8F+bPj+U+PEH2eiG+FSIkR5/qZcAlTNbOLVf/QwZat/4Pb7jOIYZLD3tQ==`
- License: MIT

## Reviewed contents

The review covered the package manifest, README, license, TypeScript configuration, upstream tests,
and every production file under `src/`. The npm tarball matched the files at the recorded commit.

The extension executes no shell commands and installs no shell hooks. Its fallback starts the fixed
command `codex app-server --listen stdio://` without a shell, uses bounded request timeouts, and
terminates the child after each query. It reads no files. It obtains OpenAI Codex subscription
authentication through Pi's public model registry, sends it only to the fixed
`https://chatgpt.com/backend-api/wham/usage` endpoint, and redacts bearer tokens from bounded error
text. It sends no telemetry, intercepts no provider requests, overrides no tools, handles no project
trust decisions, and creates no persistent background resources.

## Local changes

- Renamed the private package to `@onurpi/codex-usage` and added the repository-standard root entry
  point and quality configuration.
- Removed upstream status timers and broad statusline behavior, along with the `--no-statusline` and
  `--clear-statusline` flags.
- Added a local model-gated weekly status that exists only for active `openai-codex` models. It uses
  Pi lifecycle hooks without timers, shares the command cache and in-flight query, clears on other
  providers, and stays quiet on automatic failures.
- Kept `/codex-status`, explicit refreshes, bounded timeouts, the five-minute in-memory report
  cache, Pi-auth usage queries, the temporary Codex app-server fallback, full report formatting, and
  reset-credit reporting.
- Replaced unchecked external-payload casts with strict unknown-input validation.
- Added tests for command behavior, cache and request deduplication, model gating, weekly status
  formatting, lifecycle races, payload normalization, and full report formatting.
