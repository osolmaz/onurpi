# Upstream provenance

`@onurpi/unified-exec` is based on
[`iamwrm/pi-unified-exec`](https://github.com/iamwrm/pi-unified-exec).

- Release: `v0.7.3`
- Commit: `3cad4a93f430b16bb4fb59cdf4a42cc005a933e7`
- Retrieved: July 22, 2026
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
- `src/pty.ts`
- `src/render.ts`
- `src/session-store.ts`
- `src/session.ts`
- `src/shell.ts`
- `src/time.ts`
- `src/unescape.ts`

It also covered all 16 upstream test files, `README.md`, `Changelog.md`, `AGENTS.md`,
`to_improve.md`, the three files under `docs/`, `package.json`, `package-lock.json`,
`tsconfig.json`, and the GitHub Actions test and publishing workflows. The unmodified upstream
release passed 254 tests with four platform-specific skips on Linux before adoption.

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
  names or command-session semantics.
- Ported the 12 upstream unit suites directly to Vitest. The four upstream extension-API harness
  suites (`chars-encoding`, `e2e`, `e2e-pty`, and `wake-e2e`) used unchecked `any` stubs, so their
  applicable process, byte-input, PTY, waiting, kill, and wake scenarios were consolidated into a
  strict typed runtime integration suite. The package currently runs 193 tests, plus a platform skip
  when PTY is unavailable.
- Retained strict TypeScript, unsafe-operation linting, and the repository's complexity limit.
  Audited upstream lifecycle and rendering routines use narrow, justified line-level complexity
  suppressions rather than a package-wide exemption.
- Deferred synthetic completion delivery while an agent run is active. This lets a finalized
  terminal `write_stdin` result consume the wake before `agent_settled`; truly unobserved
  completions still deliver one follow-up after settlement.
- Create POSIX session logs exclusively with mode `0600` instead of inheriting an umask that may
  expose complete command output to other local users.
- Added cancellable output waits so quiet timed-out polls and stopped absolute-wait renderers do not
  retain notification closures until future process output.
- Reject incomplete base64 quanta instead of letting Node decode malformed binary input into an
  empty write that behaves like a poll.
- Bound output accumulated during each attached wait to two response windows while the complete
  stream continues to the private log file.
- Invalidate collapsed TUI preview lines when a streamed result body changes.
- Kept upstream v0.7.3's `set_on_exit` tool and human-explicit wake guidance.
- Removed upstream publishing and repository-maintenance machinery from the vendored package.
