# Upstream provenance

| Field                    | Value                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| Repository               | https://github.com/ogulcancelik/pi-extensions                                     |
| Subdirectory             | `packages/pi-codex-compaction`                                                    |
| Commit                   | `15026bb69070aa2bf844867e338590ba0dafcc93` (reviewed `main` HEAD)                 |
| Latest package commit    | `ca37adb6c8000f6a83c447b4a119657c7714bc94`                                        |
| Retrieved                | 2026-08-08                                                                        |
| Upstream package version | `0.1.3`                                                                           |
| License                  | MIT (© Can Celik), preserved in [LICENSE](LICENSE)                                |
| Regraft                  | `pi-codex-compaction` in `regraft.json`, tracked from `main` at the pinned commit |

## Reviewed contents

The review covered `package.json`, `README.md`, `LICENSE`, `config.ts`, `index.ts`,
`native-compaction.ts`, and `index.test.ts` at the pinned commit. OnurPi no longer includes the
upstream config module; see the local adaptations below.

- **Process/shell execution:** none.
- **Filesystem access:** none. OnurPi removed the upstream config lookup and does not create files.
- **Network access:** exactly one outbound call shape — `POST <baseUrl>/codex/responses` with the
  session history — plus header-only interception of Pi's own Codex provider requests.
- **Credential handling:** resolves the active Codex API key through Pi's documented
  `modelRegistry.getApiKeyAndHeaders`, derives the ChatGPT account ID locally from the JWT payload,
  and attaches both as request headers. **Upstream sent these credentials to whatever
  `model.baseUrl` was configured.** OnurPi hardens this: the endpoint is validated against the
  official Codex hosts (`chatgpt.com`, `chat.openai.com`, `api.openai.com`, HTTPS only, no userinfo,
  no non-default port) before any header is attached, and anything else fails closed with an error
  that names the host but never the credential. Tokens never appear in errors, logs, tests, or this
  provenance record; test tokens are structurally valid fakes carrying only a fake account ID.
- **Telemetry:** none beyond the requests above. The upstream `originator: pi` /
  `user-agent: pi-codex-compaction` headers are kept.
- **Provider interception:** `before_provider_request` rewrites the Responses `input` for
  `openai-codex` models from the stored native checkpoint; `before_provider_headers` merges the
  `remote_compaction_v2` beta feature. Both pass non-Codex models through untouched.
- **Tool overrides:** none. Registered tools are only serialized into the compaction request body.
- **Trust handling:** project-local config is honored only when `ctx.isProjectTrusted()` is true.
- **Background resources:** none. Retry backoff uses in-memory timers bound to the request's abort
  signal.
- **Session persistence:** native checkpoints are stored in Pi's normal `CompactionEntry.details`;
  TUI status updates are appended as `openai-codex-compaction-status` custom entries. The stored
  `encrypted_content` is opaque provider state, not a credential.
- **Malformed external data:** SSE streams, checkpoint payloads, and JWT structure are validated;
  failures are fail-closed (compaction cancelled or request aborted) rather than fallbacks. Upstream
  error paths could embed unbounded HTTP error bodies in UI notifications; OnurPi bounds them to a
  300-character preview.

## Local adaptations

- Renamed the private package to `@onurpi/pi-codex-compaction`; pinned Pi peer dependencies to the
  installed 0.82.1 generation. Nothing is published.
- Ported the Bun test suite to Vitest and split `native-compaction.ts` into `native-checkpoint.ts`
  (checkpoint parsing/lookup), `responses-input.ts` (Pi message → Responses input conversion), and
  `remote-compaction.ts` (endpoint validation, headers, SSE, retries). `index.ts` is thin wiring
  around `codex-compaction.ts`, matching OnurPi's package layout.
- Strict TypeScript throughout: removed every explicit `any`, `as any`, non-null assertion, and
  `delete`-based key removal from sources and tests; harnesses are typed against the package's own
  narrow context and API surfaces.
- **Endpoint allowlist for credentials** (see above) — new behavior, deliberately stricter than
  upstream.
- Resolves the built-in `openai-codex` credential through Pi's normal request auth path after the
  endpoint guard. The Codex switcher overrides that provider in place and exposes its leased account
  through the same auth path.
- Bounded HTTP error bodies in error messages (300 characters).
- Added test coverage for credential/base-URL safety, model-mismatched checkpoints, auth resolution
  failure, and non-Codex pass-through of every hook.
- Resolved the interaction with OnurPi's compaction packages (hard cutover, documented in
  [README.md](README.md#compaction-ownership-in-onurpi)): `context-window-policy` passes Codex
  models through to this extension, and `reliable-compaction` no longer arms its SSE retry override
  for the built-in `openai-codex` provider.
- Removed the upstream proactive controller as a hard cutover. The package no longer reads
  `autoCompact` or `thresholdRatio`, listens to `turn_end`, calls `ctx.abort()` to schedule
  compaction, listens to `agent_settled`, or sends a continuation user message. Pi owns manual,
  threshold, and overflow scheduling and continuation; the package only supplies native checkpoint
  results through `session_before_compact`.
- Other upstream behavior for checkpoint creation, fail-closed cancellation, and duplicate
  prevention is preserved.
