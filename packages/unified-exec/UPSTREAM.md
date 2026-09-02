# Upstream provenance

`@onurpi/unified-exec` is based on
[`iamwrm/pi-unified-exec`](https://github.com/iamwrm/pi-unified-exec).

- Release: `v0.9.0`
- Commit: `7c8c1d809ef80d25fb60b5129248b2077b2422e9`
- Retrieved: August 6, 2026
- License: MIT, preserved in [`LICENSE`](LICENSE)

## Reviewed material

The review covered every production source file from the release:

- `src/collect.ts`
- `src/completion.ts`
- `src/format-time.ts`
- `src/head-tail-buffer.ts`
- `src/index.ts`
- `src/long-wait.ts`
- `src/notify.ts`
- `src/output-safety.ts`
- `src/pty.ts`
- `src/render.ts`
- `src/session-store.ts`
- `src/session.ts`
- `src/shell.ts`
- `src/time.ts`
- `src/tool-result.ts`
- `src/unescape.ts`

It also covered all upstream test files, `README.md`, `Changelog.md`, `AGENTS.md`, `to_improve.md`,
the files under `docs/` (including `IV-0002-output-lifecycle-and-rendering.md`), `package.json`,
`package-lock.json`, `tsconfig.json`, and the GitHub Actions test and publishing workflows.

## Runtime audit

- **Process execution:** The extension intentionally launches model-requested commands and preserves
  sessions across tool calls.
- **Shell behavior:** It removes Pi's built-in `bash` tool by default and registers `exec_command`,
  `write_stdin`, `set_on_exit`, `kill_session`, and `list_sessions`.
- **Filesystem access:** It creates full-output logs under the operating system temporary directory
  and probes executable paths. The extension itself does not edit project files, though launched
  commands retain the user's permissions.
- **Network access:** Production code performs no network requests.
- **Credentials and environment:** Child processes inherit `process.env`. Production code does not
  inspect credential stores or transmit telemetry.
- **Provider interception:** None.
- **Project trust handlers:** None.
- **Background resources:** It owns child processes, timers, output streams, and PTYs. Session
  shutdown terminates owned processes and clears completion scheduling.
- **Native code:** PTY mode uses the optional, exactly pinned
  `@homebridge/node-pty-prebuilt-multiarch@0.13.1`. Pipe mode works when the optional module is
  unavailable.

## Native PTY audit

The optional PTY package was audited separately because it loads native code and owns its own
installation lifecycle.

- npm tarball integrity:
  `sha512-ccQ60nMcbEGrQh0U9E6x0ajW9qJNeazpcM/9CH6J8leyNtJgb+gu24WTBAfBUVeO486ZhscnaxLEITI2HXwhow==`
- Repository tag: `v0.13.1`, commit `507b670ecd022c8538f35f10d5f13cf3e175005e`
- Published: July 3, 2025
- License: MIT
- Supported Node range: 18 through 24
- Runtime behavior: loads the ABI-, platform-, architecture-, and libc-specific `pty.node`; it does
  not perform network requests or access credential stores.
- Install behavior: first loads and tests a bundled prebuild. If no usable bundled prebuild exists,
  `prebuild-install` may download a release asset from the dependency's GitHub release, outside
  npm's tarball-integrity boundary. If that fails, `node-gyp` compiles the bundled source.
  `postinstall` removes unexpected build artifacts and, on Windows, copies the bundled ConPTY files
  into the release directory.
- Local verification: Node 22 ABI 127 on Linux arm64 loaded the bundled prebuild and passed the real
  TTY integration test. The loaded binary's SHA-256 was
  `664296c69e47f0313b2da6f8e2b352b55df1648255d047ac54bb16e6a096fe72`.
- `npm audit` reported no advisory in the PTY package or its `prebuild-install` dependency chain.
  The workspace's reported advisories were in unrelated Pi development dependencies.

A successful npm integrity check authenticates the package tarball, including bundled Linux
prebuilds, but not a fallback GitHub download. PTY therefore remains optional and a separate trust
boundary; Unified Exec reports a clear error instead of silently changing execution mode when the
native module cannot load.

## Local changes

- Renamed the private package to `@onurpi/unified-exec` and integrated it with OnurPi's package, CI,
  coverage, and Slophammer conventions.
- Reorganized the upstream entry point into smaller strict TypeScript modules without changing tool
  names or command-session semantics. Upstream v0.9.0's shared result layer was adopted as
  `src/tool-result.ts` and its renderer rewrite as `src/render.ts`, both converted to strict typed
  code without `any` casts.
- Ported the upstream unit suites to Vitest, including the v0.8.0–v0.9.0 `output-safety`,
  `tool-result`, and renderer suites. The upstream extension-API harness suites used unchecked `any`
  stubs, so their applicable process, byte-input, PTY, waiting, kill, and wake scenarios were
  consolidated into a strict typed runtime integration suite. The package currently runs 223 tests,
  plus a platform skip when PTY is unavailable.
- Retained strict TypeScript, unsafe-operation linting, and the repository's complexity limit.
  Audited upstream lifecycle, scanning, and rendering routines use narrow, justified line-level
  complexity suppressions rather than a package-wide exemption.
- Added public synchronous events before process spawn and nonempty process input. The spawn event
  includes the originating tool call and a unique invocation ID. Both events support explicit
  rejection before bytes reach the child. Added a final policy registry that runs immutable checks
  after event listeners and immediately before those actions.
- Deferred synthetic completion delivery while an agent run is active. This lets a finalized
  terminal `write_stdin` result consume the wake before `agent_settled`; truly unobserved
  completions still deliver one follow-up after settlement.
- Create POSIX session logs exclusively with mode `0600` instead of inheriting an umask that may
  expose complete command output to other local users.
- Added cancellable output waits so quiet timed-out polls and stopped absolute-wait renderers do not
  retain notification closures until future process output.
- Reject incomplete base64 quanta instead of letting Node decode malformed binary input into an
  empty write that behaves like a poll.
- Bound output accumulated during each attached wait to two response windows while preserving full
  byte and line metadata; the complete stream continues to the private log file. Upstream v0.8.0
  instead collects unboundedly and splices an in-band omission marker at the drop point; OnurPi
  keeps its bounded collection and feeds the exact totals into the v0.9.0 result envelope, whose
  `omitted_bytes` / `output_bytes_total` fields and truncation marker report the loss.
- Keep the bounded output only in `details.output`. Truncation metadata excludes the duplicate
  `content` field, so a maximum-size result does not store the same 50 KiB tail twice.
- Upstream v0.9.0 bounds `kill_session` output through the canonical result envelope and pauses
  neither pipe nor PTY output for the complete-log writer; OnurPi additionally pauses child output
  while the log writer is backpressured.
- Retry transient completion-message send failures automatically while the session remains alive.
- Accept extension-bearing Windows shell names, including `.com`, and exclude unspawnable command
  wrappers from the default shell probe.
- Deduplicate stored and in-flight sessions before shutdown termination and accounting.
- Kept upstream's `set_on_exit` tool and human-explicit wake guidance, the v0.8.0 `cols`/`rows` PTY
  geometry parameters, the event-driven kill/shutdown waits, the single-sort LRU prune, and the
  `[wake]` indicator (previously `⏰wake`).
- Upstream v0.8.0–v0.9.0 adopted equivalents of earlier OnurPi fixes (dead reserved-ID tracking
  removal, stale collapsed-preview invalidation, oversized single-chunk stream-tail trimming); those
  local patches are now subsumed by the upstream implementations.
- Removed upstream publishing and repository-maintenance machinery from the vendored package,
  including the changelog, design docs, issue/interaction-limit workflows, and npm lockfile.
