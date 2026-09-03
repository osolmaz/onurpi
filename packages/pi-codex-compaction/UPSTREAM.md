# Upstream provenance

| Field                    | Value                                                                             |
| ------------------------ | --------------------------------------------------------------------------------- |
| Repository               | https://github.com/ogulcancelik/pi-extensions                                     |
| Subdirectory             | `packages/pi-codex-compaction`                                                    |
| Commit                   | `207ecb4aef9aa6725b8459e44b5580151229cd8e` (reviewed `main` HEAD)                 |
| Latest package commit    | `c4d6ca8fb484ba51684296ba8b4715f8c7b3ac91`                                        |
| Retrieved                | 2026-08-24                                                                        |
| Upstream package version | `0.1.4`                                                                           |
| License                  | MIT (© Can Celik), preserved in [LICENSE](LICENSE)                                |
| Regraft                  | `pi-codex-compaction` in `regraft.json`, tracked from `main` at the pinned commit |

## Reviewed contents

The review covered `package.json`, `README.md`, `LICENSE`, `config.ts`, `index.ts`,
`native-compaction.ts`, and `index.test.ts` at the pinned commit.

- **Process/shell execution:** none.
- **Filesystem access:** none (the historical optional JSON configuration files were removed with
  the proactive controller).
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
- **Trust handling:** no configuration input remains, so project trust no longer changes behavior.
- **Background resources:** none. Retry backoff uses in-memory timers bound to the request's abort
  signal.
- **Session persistence:** native checkpoints are stored in Pi's normal `CompactionEntry.details`.
  Pi's transient compaction indicator is not saved. The stored `encrypted_content` is opaque
  provider state, not a credential.
- **Malformed external data:** SSE streams, checkpoint payloads, and JWT structure are validated;
  failures are fail-closed (compaction cancelled or request aborted) rather than fallbacks. Upstream
  error paths could embed unbounded HTTP error bodies in UI notifications; OnurPi bounds them to a
  300-character preview.

## Local adaptations

- Renamed the private package to `@onurpi/pi-codex-compaction`; reviewed it against the installed Pi
  0.84.3 generation. Nothing is published.
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
  [README.md](README.md#compaction-ownership-in-onurpi)): `reliable-compaction` does not arm its SSE
  retry override for the built-in `openai-codex` provider.
- Removed the upstream proactive controller entirely. The extension no longer reads `autoCompact` or
  `thresholdRatio`, no longer aborts after `turn_end`, compacts after `agent_settled`, or sends a
  continuation message, and the extension-local configuration file is gone. The proactive controller
  could append a native checkpoint between an assistant function call and its function result; Pi's
  serialized built-in threshold, overflow, and manual compaction lifecycle now owns every trigger,
  and this extension only provides the remote checkpoint.
- Removed OnurPi's temporary `context-window-policy` controller after Pi 0.84.4 added a native
  pre-response compaction barrier for tool loops. Normal Pi settings now put the default Codex model
  at a 90% threshold without aborting the active turn.
- Added a fail-closed branch snapshot fence around the remote call. Before a checkpoint is returned,
  the active branch must contain the same entry IDs in the same order as `event.branchEntries`. Any
  change cancels the compaction without content.
- Other upstream behavior for checkpoint creation and fail-closed cancellation is preserved.
- Adopted upstream `c4d6ca8` ("fix(codex-compaction): sanitize cross-provider history", 0.1.4):
  reasoning items, text-signature item ids, and tool-call item ids replay only when the stored
  message's provider and API match the active Codex model, foreign reasoning state is dropped from
  the Responses replay, and the response-only `status` field is stripped from replayed reasoning and
  assistant message items. Ported into `responses-input.ts` with regression tests in
  `conversion.test.ts`.
