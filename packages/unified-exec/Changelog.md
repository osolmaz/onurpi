# Changelog

All notable changes to this project. **Newest entries go on top.**

## 2026-07-22 — 0.7.3

### Fixed

- **Windows PowerShell hang under Node 24 CI:** `buildShellCommand` now
  passes `-NonInteractive -NoLogo` (with existing `-NoProfile -Command`) so
  short `shell: "powershell"` commands exit when stdin is kept open as a pipe
  for `write_stdin`. Fixes CI failure on `windows-latest` + Node 24 where
  `Write-Output` never finished within the yield window.

## 2026-07-22 — 0.7.2

### Fixed / improved (post-review top 5)

- **wake-e2e hygiene:** harnesses auto-`session_shutdown` in `afterEach`;
  async-aware `waitFor`; fewer fixed long sleeps around debounce.
- **`list_sessions` + widget + slash picker show `wake_armed` / `⏰wake`** so
  agents and humans can audit which sessions will auto-resume.
- **`set_on_exit` by coordinator id:** can disarm LRU tombstone wakes even when
  the session is no longer in the store; unknown ids still return `found: false`.
  Tool text notes disarm cannot recall an already-queued follow-up.
- **Cleanup:** `src/format-time.ts` unifies duration labels; removed unused
  `policy` field on completion records; `renderSetOnExitCall` for TUI.
- **Tests:** tombstone disarm unit test; unknown sid + list `wake_armed` e2e.
- **Docs refreshed:** README (`set_on_exit` tombstones/status tokens,
  `wake_armed`, TUI remaining + `set_on_exit` banner, architecture +
  `format-time.ts` + workspace docs), `docs/DEV.md` layout table, IV-0001
  implementation map.

## 2026-07-22 — 0.7.1

### Added

- **Agentic workspace docs:** `docs/DC-0001-agentic-workspace.md` (IV/DC
  doctrine) and `docs/IV-0001-long-wait-and-wake-control.md` (this release’s
  initiative: remaining-time TUI, human-explicit wait/wake guidance, horizon
  removal, `set_on_exit`, evidence).
- **`set_on_exit(session_id, on_exit)` tool.** Change a live session's
  completion policy without killing it: `"none"` disarms a pending wake
  (process keeps running); `"wake"` arms auto-resume if still running.
  Disarm after exit but before the debounced wake flush also suppresses the
  notification. Mid-flight flush re-checks suppression so a disarm cannot
  race a reserved send. Status tokens: `disarmed`, `already_none`, `armed`,
  `already_armed`, `too_late`.
- **TUI remaining countdown for `yield_until`.** Call banners and streaming
  footers show human remaining time (`2h40m later`, `12m later`, `45s later`,
  `now`) instead of only the raw ISO deadline. ISO stays in tool result
  metadata for the model. Shared helper: `formatRemainingLater` (now in
  `src/format-time.ts` as of 0.7.2; still re-exported from `time.ts`).

### Changed

- **Removed the default 10 h `yield_until` horizon.** Any valid RFC 3339 UTC
  future timestamp is accepted (past still = immediate poll). Dropped
  `PI_UNIFIED_EXEC_MAX_ABSOLUTE_WAIT_MS`, `DEFAULT_MAX_ABSOLUTE_WAIT_MS`, and
  `resolveMaxAbsoluteWaitMs`. Multi-day waits chunk `setTimeout` arms at
  `MAX_TIMER_ARM_MS` (`2^31-1`) so timers never overflow.
- **Tool guidance tightened against cache-busting and stale wakes.**
  - `yield_until`: only when the human explicitly asks for a long attached
    wait or wall-clock deadline — not to bypass the 290 s `yield_time_ms`
    cap; repeat ≤290 s polls instead.
  - `on_exit`: default remains `"none"`; use `"wake"` only when the human
    explicitly wants auto-resume; if armed by mistake, `set_on_exit … none`
    promptly. write_stdin no longer promotes wake.
- **Docs** (README) updated for `set_on_exit`, human-explicit wait/wake
  rules, no 10 h cap, and remaining-time TUI.

### Tests

- `formatRemainingLater` unit coverage; far-future `yield_until` accepted;
  long-wait multi-arm chunking; CompletionCoordinator `setOnExit` paths;
  wake-e2e: disarm failed job (0 wakes) and late-arm from `none` → 1 wake.

## 2026-07-21 — 0.7.0

### Added

- **`write_stdin(yield_until)` — absolute-deadline waits.** Empty polls can
  now stay attached until a strict RFC 3339 UTC deadline (`"2026-07-21T18:30:00Z"`,
  0–3 fractional digits, uppercase `Z` only; offsets, local timestamps, and
  JS-normalized impossible dates are rejected; accepted values are normalized
  with `Date.toISOString()`). Semantics: mutually exclusive with
  `yield_time_ms` and with input bytes; returns immediately on process exit;
  a past deadline is an immediate poll; cancellation never kills the child;
  default horizon 10 h with a new `PI_UNIFIED_EXEC_MAX_ABSOLUTE_WAIT_MS`
  override — excessive deadlines are rejected with an actionable error, never
  clamped. The wait is event-driven (exit / cancellation / one timer) on a
  **monotonic** deadline (wall-clock parsed once, then anchored to
  `performance.now()`), never drains output into an unbounded local
  collection (the session's bounded head/tail buffer, rolling TUI tail, and
  full on-disk log keep working), and replaces the 250 ms TUI heartbeat with
  an initial update + output-driven updates rate-limited to 30 s + a final
  update (nothing when nothing changes). Exit wins close exit/deadline/cancel
  races whenever the session is terminal when the result is assembled. New
  `src/time.ts` and `src/long-wait.ts`.
- **`exec_command(on_exit: "wake")` — completion notifications.** A new
  persistent per-session policy (default `"none"`, Google-compatible
  string-enum schema): when a backgrounded wake session exits while no tool
  call is observing it, exactly one synthetic follow-up prompt
  (`pi.sendMessage` with `customType: "unified-exec-completed"`,
  `triggerTurn: true`, `deliverAs: "followUp"`) resumes the agent — starting
  a turn when idle, queued as a follow-up during an active run, never
  steering. Implemented as a dedicated agent-level `CompletionCoordinator`
  (`src/completion.ts`) enforcing the exactly-once invariant: terminal
  completion is delivered through a finalized tool result OR causes one
  wake, never both. `write_stdin` calls take observation leases; "observed"
  commits at pi's finalized `tool_execution_end` (an error/cancelled
  finalization keeps the wake eligible); deadline/cancellation releases the
  lease with the wake armed. Wakes are armed only after `exec_command`
  commits to returning a `session_id` (in-yield exits return directly),
  reserved before sending (no duplicates across repeated exit callbacks or
  flush triggers), debounced so simultaneous completions batch into one
  bounded prompt, and retried at the next flush point if submission throws.
  Suppression: `kill_session` and `/unified-exec-sessions` suppress before
  signaling (failed kills restore eligibility), live-process LRU eviction
  and `session_shutdown` suppress, `list_sessions` observing the exit first
  suppresses, and a naturally-exited wake session evicted before
  notification keeps a bounded tombstone snapshot (with `log_path`) so its
  one wake still fires. The prompt carries sanitized bounded metadata
  (session id, exit code/signal, one-line command, cwd, elapsed, log path,
  failure info) — never raw stdout/stderr — and the exited session stays
  drainable afterwards without triggering a second wake.
- **`tool_time_utc` everywhere it matters**: still-running responses,
  absolute-deadline responses, direct terminal results of waits, and
  validation errors now report the current host UTC time so the model can
  compute wall-clock deadlines itself (no precomputed 10-hour deadline is
  handed out). New response fields: `wait_mode`, `wait_status`,
  `yield_until`, `effective_wait_ms`, `on_exit`, `completion_notification`,
  `completion_delivery`, `on_exit_wake`.
- **Tests**: 68 new tests (`tests/time.test.ts`, `tests/long-wait.test.ts`,
  `tests/completion.test.ts`, `tests/wake-e2e.test.ts`) covering timestamp
  validation, argument validation, long-wait behavior with injected
  monotonic clocks/timers (no real 290 s / 10 h waits), and the full wake
  state machine through the real tool pipeline (246 total).

### Verified

- **Live end-to-end run against real pi 0.80.10** (interactive TUI in tmux,
  `gpt-5.6-sol`, extension loaded via `--no-extensions -e ./src/index.ts`):
  (1) `on_exit: "wake"` → idle exit delivered exactly one
  `unified-exec-completed` follow-up that started a turn; the model drained
  the exited session afterwards with no duplicate wake. (2) `yield_until`
  accepted by the provider schema; the model computed a valid deadline from
  `tool_time_utc`; exit-before-deadline returned `wait_status: completed`
  immediately and consumed the wake (no follow-up). (3) Esc during an
  absolute wait: pi aborted the turn ("Operation aborted"), the footer
  showed `until … · cancelled · wake armed`, the process survived, and the
  later natural exit fired exactly one wake from the aborted-idle state.
  Across 4 sessions: exactly 2 wakes (unobserved exits) and 2 direct
  consumptions — the exactly-once invariant held.

### Changed

- **Empty-poll `yield_time_ms` above the cap is now rejected, not clamped**,
  with an actionable error that names `yield_until` and includes
  `tool_time_utc`. `PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS` can still lower the
  cap but no longer raises the effective cache-friendly maximum above
  290 s (previously it could raise it arbitrarily). Defaults, minimums, and
  interactive-input clamping are unchanged.
- **TUI result footer** now surfaces long-wait state: `until <deadline>`
  while a `yield_until` session is still running, a `cancelled` marker for
  aborted absolute waits, and `wake armed` when a completion notification is
  pending.
- **Tool guidance rewritten** around the four rules: `yield_time_ms` for
  interaction/progress polls ≤ 290 s; `yield_until` for deliberate longer
  waits on finite non-interactive commands; `on_exit: "wake"` to resume on
  unobserved completion; combining them is safe. `yield_time_ms` is now
  described as an attachment/progress window, not a process lifetime. An
  explicit warning forbids `yield_until` for REPLs, sudo, ssh, password
  prompts, dev servers, file watchers, debuggers, and other
  indefinite/interactive sessions.
- **Dependency minimums**: `@earendil-works/pi-coding-agent` peer range
  narrowed from `*` to `>=0.80.5` — the first published version with the
  `agent_settled` extension event, used as a safe flush point for pending
  completion notifications (`tool_execution_end` finalization existed
  earlier). Dev pins bumped 0.80.3 → 0.80.10. The `agent_settled`
  subscription is wrapped in try/catch so older runtimes degrade gracefully
  (wakes still deliver via the debounce timer and tool boundaries).

## 2026-07-10 — 0.6.2

### Changed

- **Default empty-poll yield cap lowered to 290 seconds**: reduced the default
  empty `write_stdin` poll `yield_time_ms` upper clamp from 30 minutes to
  290 seconds so a long poll never outlives Anthropic's default 5-minute
  prompt-cache TTL. The `PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS` env override still
  allows raising the cap (e.g. back to `1_800_000`) for cache-insensitive
  runs. Updated tool guidance, README, and tests accordingly.

## 2026-07-10 — 0.6.1

### Added

- **Windows: find Git Bash even when it's not on PATH.** Git for Windows'
  default installer option adds only `Git\cmd` (git.exe) to PATH — not
  `Git\bin` — so the most common setup is "git works, bash doesn't", and
  those users were silently downgraded to powershell. The default-shell
  probe (and explicit `shell: "bash"`) now resolves in order:
  1. `PI_UNIFIED_EXEC_BASH` env var (explicit override, must be a file)
  2. `bash` on PATH (WSL System32 stub still excluded)
  3. derived from `git.exe` on PATH — walk up from git's directory probing
     `<root>\bin\bash.exe` (covers `Git\cmd`, `Git\bin`,
     `Git\mingw64\bin` layouts)
  4. well-known install roots: `%ProgramFiles%\Git`, `%ProgramW6432%\Git`,
     `%ProgramFiles(x86)%\Git`, `%LocalAppData%\Programs\Git`
  5. powershell fallback (warning now mentions `PI_UNIFIED_EXEC_BASH`)

  Derived/fixed-path hits use `bin\bash.exe` (Git's launcher, which sets
  up MSYS PATH so `ls`/`grep`/`sed` work in the child — verified with a
  stripped PATH), never `usr\bin\bash.exe`. A one-time info notice reports
  when bash is used from off PATH. Security posture unchanged: only
  absolute paths under admin/user-owned install roots or the tree of an
  already-PATH-trusted git.exe are probed; every candidate must be a
  regular file; nothing cwd-relative. Registry lookup and MSYS2/Cygwin
  roots deliberately omitted.

### Fixed

- De-flaked the three running-session UI tests (fixed sleeps → polling):
  `sleep 0.4` exceeded the 700 ms wait on a loaded windows-latest runner.

## 2026-07-10

### Fixed (second review round)

A second review pass (different reviewer model, empirical reproductions)
found residual issues in the Windows PR; all majors addressed:

- **taskkill was cwd-hijackable**: Windows' CreateProcess checks the
  parent's cwd before PATH for bare names, so a `taskkill.exe` planted in
  an untrusted repository would run on every kill. Now invoked via the
  absolute `%SystemRoot%\System32\taskkill.exe`.
- **Failed kills were reported as successful**: `kill_session` removed the
  session from the store even when the process never exited (e.g. taskkill
  failure/access denied), silently dropping ownership of a live process.
  Termination outcomes now carry `killed`; unconfirmed kills keep the
  session registered and return an explicit FAILED message (same for the
  `/unified-exec-sessions` command and the shutdown notification).
- **Shutdown raced session creation**: `exec_command` inserts into the
  store only after the 150 ms early-exit grace, so a `session_shutdown`
  inside that window drained the store without seeing the new child —
  reproduced, orphaning a live process. Spawned sessions are now tracked in
  a pending set that shutdown also terminates, and new `exec_command`s are
  rejected after shutdown until the next `session_start`.
- **Multiline cmd.exe commands were silently truncated**: `cmd /c` stops at
  the first newline. `buildShellCommand` now fails closed with a clear
  error (join with ` & `, or use powershell/bash) instead of silently
  running only the first line.
- **Unresolved bare shell names could execute from the workdir**:
  `resolveBinary`'s bare-name passthrough let CreateProcess find a planted
  `powershell.exe` in the child cwd. Shell resolution now fails closed
  (`resolveWindowsShell` throws for unresolvable names, only accepts
  .com/.exe — Node can't spawn .cmd/.bat directly), and the last-resort
  powershell fallback is the canonical absolute System32 path, never a
  bare name.
- **Windows-only cmd specialization no longer leaks to POSIX**: a POSIX
  binary named `cmd` now gets plain `-c` (powershell/pwsh keep `-Command`
  everywhere — pwsh is cross-platform).
- **findOnPath resolves relative PATH entries to absolute paths** (results
  were cwd-dependent), and the double force-kill on Windows shutdown was
  removed.
- **PTY input now has a mandatory cross-platform assertion**: a repo-owned
  Node line-echo fixture asserts write_stdin round-trips (and exit-code
  propagation) under a real PTY on every platform — no longer only the
  skippable python REPL test. The Windows-only direct CI step also runs
  pty-load first so it can't pass by skipping.
- **README**: PTY examples now use `\r` (Enter) instead of `\n`; added a
  supply-chain note documenting that the native ConPTY prebuild is fetched
  by `prebuild-install` outside npm's integrity envelope (pinned exactly;
  vendor or build from source for stricter guarantees).

Known residual (documented): LRU eviction and shutdown kills remain
best-effort (no per-kill confirmation loop); Job Objects remain the
follow-up for true group-kill semantics.

## 2026-07-09

### Fixed (post-review)

A multi-perspective code review of the Windows PR produced 17 confirmed
findings; all majors and most minors addressed:

- **`shell: "cmd"` with `tty: true` was broken**: node-pty has no
  `windowsVerbatimArguments` and its `argsToCommandLine()` re-escapes
  embedded quotes, mangling the pre-quoted `/s /c` payload into a
  guaranteed syntax error (and diverging the executed command from the
  displayed one). The PTY path now passes the args as a single raw
  command-line string, which node-pty uses verbatim. Covered by a new
  Windows PTY e2e test.
- **PTY dependency load is now guarded in CI**: new `tests/pty-load.test.ts`
  asserts `isPtyAvailable()` when `EXPECT_PTY=1` (set on all matrix legs),
  so a prebuild failure is a red build instead of a silent skip of the
  whole PTY suite. The dep is pinned exactly (`0.13.1`) since
  `disposeWindowsConpty` relies on undocumented internals (now also locked
  by a mock-agent unit test).
- **Dropped the fallback `require("node-pty-prebuilt-multiarch")`**: the
  old package name is no longer declared, so Node's resolution would walk
  ancestor `node_modules` — a planted package could inject unaudited native
  code. Only the declared @homebridge package is loaded.
- **Shell resolution hardening**: `findOnPath` only accepts regular files
  (a directory named `bash` no longer matches) and returns absolute paths;
  bare shell names are resolved to their absolute PATH match before
  spawning (Windows' CreateProcess checks the child's cwd — the
  LLM-supplied workdir — before PATH); System32's WSL `bash.exe` stub is
  excluded from the default-shell probe; resolutions are cached
  (previously every Windows PTY spawn re-scanned PATH synchronously).
- **Windows kill escalation removed**: the "SIGKILL escalation" was a
  byte-identical second `taskkill /T /F` after a wasted 2 s poll; on
  Windows the first kill is already final, so escalation is skipped.
- **Real fallback-branch coverage**: `resolveDefaultShell` takes an
  injectable env; tests drive both the bash-found and powershell-fallback
  branches (plus caching) with synthetic PATH fixtures on every platform.
  cmd.exe quoting is e2e-tested against `&`, embedded quotes, `%VAR%`,
  parentheses, and pipes — the inputs the mechanism exists for.
- **CI**: direct PTY diagnostic step scoped to Windows (was doubling the
  slowest suite on all 6 legs). Removed a redundant SIGSEGV assertion and
  a stale python3 silent-skip branch that could mask real REPL failures.

Known limitation (documented, not fixed): `taskkill /T` cannot reach
grandchildren once the direct child has exited — true group-kill semantics
would need Windows Job Objects; tracked as a possible follow-up.

### Added

- **Windows support** (fixes [#3](https://github.com/iamwrm/pi-unified-exec/issues/3)):
  - **Process-tree kill via `taskkill /pid <pid> /T /F`**: POSIX
    process-group kills (`process.kill(-pid)`) don't exist on Windows;
    killing only the shell orphaned grandchildren, which also held the
    stdio pipes open and delayed exit detection past the escalation
    grace. Every kill path (`kill_session`, LRU eviction,
    `session_shutdown`, `/unified-exec-sessions`) now force tree-kills on
    Windows. Pipes are spawned with `detached: false` there (no process
    groups to detach into).
  - **Windows PTY (ConPTY)**: swapped the optional PTY dependency from
    `node-pty-prebuilt-multiarch` (linux/macOS prebuilds only) to the
    API-compatible `@homebridge/node-pty-prebuilt-multiarch` fork
    (adds win32 prebuilds, covers Node 22/24 ABIs). The loader prefers
    the new package and falls back to the old name. On Windows the PTY
    binary is resolved to a full path (bare `bash` fails ConPTY's
    "File not found" check), kills go through taskkill (node-pty's
    `kill()` throws on signal names and its console-list helper crashes
    on dead children), and ConPTY's conout worker thread + named-pipe
    sockets are disposed on exit — they otherwise keep the host event
    loop alive forever.
  - **Shell selection** (new `src/shell.ts`): default shell is `bash`
    everywhere; on Windows without bash on PATH it falls back to
    `powershell` with a one-time warning. Explicit `shell: "cmd"` gets
    `/d /s /c` + verbatim args (cmd's quoting rules), `powershell`/`pwsh`
    get `-NoProfile -Command`, POSIX shells keep `-c`.
  - **CI**: `windows-latest` added to the matrix. Platform-aware test
    fixes: SIGTERM-trap escalation doesn't apply on Windows (first kill
    is already final), Windows' signal table lacks
    SIGPIPE/SIGUSR1/SIGUSR2, and the python3 REPL PTY test now probes for
    a real interpreter (the WindowsApps Store stub stays alive without
    being a REPL). New `tests/shell.test.ts` (9 scenarios).

## 2026-07-08

### Fixed

- **CI failing on Node 20**: `@earendil-works/pi-coding-agent` requires
  Node >= 22.19.0 (its bundled undici 8 calls
  `worker_threads.markAsUncloneable`, which doesn't exist on Node 20, so four
  test files crashed on import with `webidl.util.markAsUncloneable is not a
  function`). Dropped Node 20 from the CI matrix in favor of 22 and 24, and
  declared `"engines": { "node": ">=22.19.0" }` in `package.json`.

## 2026-07-07 — 0.5.0

### Changed

- **Migrated to the `@earendil-works/*` package scope**: upstream pi renamed
  `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` to
  `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` in 0.74.0 (the
  old npm scope is frozen at 0.73.1; the repo moved to `earendil-works/pi`).
  All imports in `src/` and `tests/`, both peerDependencies, and both dev pins
  now use the new scope. Pi's extension loader still aliases the old scope at
  runtime, but that compat shim is slated for removal upstream. Bumped the
  package version to 0.5.0 because the peer dependency names changed.
- **Dev pins bumped 0.73.0 → 0.80.3** (`@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui`).
- Updated `README.md`, `docs/DEV.md`, and `AGENTS.md` references (package
  scope, changelog/clone URLs → `earendil-works/pi`).

### Verified

- **Upstream compatibility with `@earendil-works/pi-coding-agent` 0.80.3**:
  audited every release note from 0.73.0 to 0.80.3. Our entire import surface
  (`ExtensionAPI`, `ExtensionContext`, `AgentToolResult`,
  `ToolRenderResultOptions`, `Theme`, `TruncationResult`, `formatSize`,
  `truncateTail`, `truncateToVisualLines`, `DEFAULT_MAX_BYTES`,
  `DEFAULT_MAX_LINES`; pi-tui `Container`, `Text`, `truncateToWidth`,
  `Component`) is unchanged. The only breaking changes upstream were the
  minimum Node bump to 22.19.0 (0.75.0, dev-only impact) and the pi-ai root
  API move to `/compat` (0.80.0, we don't import pi-ai). `npx tsc --noEmit`
  clean; all 129 tests pass.

### Fixed

- **Test pins updated for new `truncateTail` line-counting semantics**:
  since pi ≥ 0.80, a trailing `\n` no longer counts a phantom empty last line
  and empty input counts 0 lines (previously `"".split("\n") → [""]` counted
  1). Updated `tests/truncate.test.ts` and the `totalLines` expectations in
  `tests/e2e.test.ts` (4001→4000, 2501→2500). No production-code change was
  needed — the `[Showing lines X-Y of Z]` marker in `src/index.ts` derives
  from the same counts and is now more accurate.

## 2026-06-10 — 0.4.0

### Fixed

- **Log-stream error no longer orphans live sessions**: a log-mirroring error
  (disk full, permissions, …) used to mark the session as exited while the
  child kept running, making it unkillable (`kill()` no-ops once exited) and
  letting `list_sessions` drop it without terminating the process. Failures
  are now recorded on the session without flipping its exited state.
- **Async spawn errors are diagnosable**: pipe-mode spawn failures delivered
  via the child's async `error` event (ENOENT shell binary, nonexistent
  `workdir`) previously produced an empty `[exited]` response with no
  exit_code, signal, failure, or output. The error message (plus a
  shell/workdir hint for ENOENT) is now surfaced as `failure_message`.
- **EPIPE no longer crashes the host**: `child.stdin` had no `error` handler,
  so writing to a child that closed its stdin raised an unhandled stream
  `error` event and crashed the whole pi process. Errors are now swallowed,
  and `write_stdin` reports `failure_message: "stdin write failed: …"` when
  bytes cannot be delivered to a live session (stdin destroyed/ended).
  `write()` also no longer conflates stream backpressure with delivery
  failure.
- **collectOutputUntilDeadline listener/timer leak**: each loop iteration
  registered fresh `abort` listeners on the exit/external signals and started
  a fresh deadline timer without ever cleaning them up — chatty processes
  tripped Node's EventTarget max-listener warning after ~10 chunks, and a
  30-minute empty poll could accumulate thousands of live timers. The
  deadline/abort promises are now created once per call and all
  listeners/timers are released when the call returns. The no-external-abort
  placeholder promise is also scoped per call (not module-global) so race
  reactions attached to it stay garbage-collectable.
- **PTY signal mapping covers the full platform table**: the numeric→name
  signal map was a hand-picked 6-entry table, so tty-mode children killed by
  SIGSEGV/SIGPIPE/SIGUSR1/… were reported as `exit_code=0`. The map is now
  built from `os.constants.signals` (exported as `signalNameFromNumber`).
- **`write_stdin` rendering of `chars_b64`**: calls carrying only a base64
  payload rendered as `⟳ poll`; they now render as `» (base64, N bytes)`.
- **`kill_session` signal validation**: signal names are normalized (`term`,
  `INT`, `sigkill` all work) and unknown names are rejected with an error
  instead of silently no-opping and then escalating to SIGKILL anyway.

### Changed

- **`list_sessions` reports exited sessions once before pruning**: instead of
  silently dropping sessions that exited between tool calls, the listing now
  includes them one final time with `running: false`, `exit_code`/`signal`,
  `failure_message`, and `log_path` (`active_count` still counts only live
  sessions), preserving the "exit information is never silently lost"
  guarantee.
- **Shutdown escalates to SIGKILL**: `session_shutdown` now waits up to 1s for
  SIGTERM'd children to exit and SIGKILLs survivors (children run in detached
  process groups and would otherwise outlive pi when they trap SIGTERM).
- **Removed dead `HEAD_TAIL_MAX_BYTES` constant** in `src/index.ts` (the
  per-session buffer cap lives in `src/session.ts`).

### Added

- **`/unified-exec-sessions` command**: human-facing escape hatch that lists
  live sessions in a selector and kills the chosen one (or all) without going
  through the model, sharing the kill/escalate/drain logic with
  `kill_session`.
- **Streaming parity test**: the e2e harness now captures `onUpdate` and
  asserts multiple growing partial outputs during a long-running
  `exec_command`, plus 14 more regression tests covering every fix above
  (129 tests total across 10 files).

## 2026-06-02 — 0.3.6

### Changed

- **Configurable empty-poll cap**: restored the default pure `write_stdin`
  empty-poll `yield_time_ms` cap to 30 minutes and added
  `PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS` so cache-sensitive environments can lower
  the cap (for example to 300 seconds / 5 minutes).

## 2026-06-02 — 0.3.5

### Changed

- **Empty-poll cache safety**: reverted pure `write_stdin` poll
  `yield_time_ms` clamping from 30 minutes back to 5 minutes (300 seconds) and
  updated model guidance/docs so long polls stay within typical prompt-cache
  expiry windows. Superseded by 0.3.6's configurable cap.

## 2026-06-01 — 0.3.4

### Fixed

- **macOS short-command output race**: pipe-mode sessions now wait for the
  child-process `close` event instead of `exit` before finalizing, preserving
  trailing stdout/stderr from very short-lived commands in CI.

## 2026-06-01 — 0.3.3

### Changed

- **Long-running job polling guidance**: updated the `write_stdin` tool prompt
  and README to tell models to use a single long empty poll for known
  non-interactive jobs instead of repeated short polls, reducing context noise.

## 2026-05-27 — 0.3.2

### Changed

- **Longer empty-poll yield cap**: raised empty `write_stdin` poll
  `yield_time_ms` clamping from 300 seconds to 30 minutes, allowing agents to
  wait longer on known-running background sessions without repeated polls.
  Superseded by the 2026-06-02 cache-safety revert.

## 2026-05-06

### Changed

- **Compatibility follow-ups resolved**: replaced the hand-restated render
  context shape with a type derived from pi's exported `ToolDefinition`, and
  documented the resolved follow-ups in `to_improve.md`.
- **Improvement backlog detail**: expanded each `to_improve.md` item with a
  lightweight plan, code references, risk evaluation, and verification gate
  based on the latest pi release notes.
- **Upstream pi 0.73.0 compatibility**: cloned and audited the latest
  `badlogic/pi-mono` source at `30298368` and updated development dependencies
  to `@mariozechner/pi-coding-agent` / `@mariozechner/pi-tui` 0.73.0. Switched
  tool schema imports and package metadata from the legacy
  `@sinclair/typebox` package name to pi's current `typebox` package while
  keeping the existing extension API usage intact.

### Added

- **Shutdown metadata coverage**: added tests for all current pi
  `session_shutdown` reasons so session cleanup remains covered across quit,
  reload, and session replacement paths.
- **Upstream improvement notes**: added `to_improve.md` with follow-up
  opportunities and pitfalls found while reviewing recent pi releases.

## 2026-04-27 — 0.3.1

### Fixed

- **macOS CI short-command drain race**: increased the bounded trailing-output
  drain window for very fast commands so stdout/stderr that arrives shortly
  after the process exit event is captured reliably on macOS Node 22.

## 2026-04-27 — 0.3.0

### Added

- **Running-session UI after `/tree`**: while unified-exec processes are still
  alive, the extension now keeps a TUI footer status. After `/tree` navigation
  it also shows a widget listing live session IDs and commands so humans can
  see that processes survived branch navigation. The footer/widget now refresh
  immediately when a background session exits, without waiting for the next
  tool call or turn.
- **Contributor guidance**: added `AGENTS.md` guidance requiring changelog
  updates alongside future code, docs, tests, or package metadata edits.

## 2026-04-27 — 0.2.2

### Changed

- **Prompt guideline safety**: changed the `exec_command` file-exploration hint
  to only prefer `grep`/`find`/`ls` when those dedicated tools are actually
  available, and to suggest shell fallbacks via `rg`, `fd` when installed,
  `find`, and `ls` otherwise.

## 2026-04-21

### Verified

- **Upstream compatibility with `@mariozechner/pi-coding-agent` 0.68.0**:
  audited the upstream 0.68.0 `CHANGELOG.md` against our extension's
  usage of pi-coding-agent. All 0.68.0 breaking changes
  (`createAgentSession({ tools })` now takes `string[]` instead of
  `Tool[]`; removal of prebuilt cwd-bound tool exports such as
  `readTool`, `bashTool`, `editTool`, `writeTool`, `grepTool`,
  `findTool`, `lsTool`, `readOnlyTools`, `codingTools`, and the
  corresponding `*ToolDefinition` values; removal of ambient
  `process.cwd()` fallbacks from `DefaultResourceLoader`,
  `loadProjectContextFiles()`, and `loadSkills()`) target APIs we do
  **not** call. The types, helpers, constants, and `ExtensionAPI`
  surface we import (`ExtensionAPI`, `ExtensionContext`,
  `AgentToolResult`, `ToolRenderResultOptions`, `Theme`,
  `TruncationResult`, `formatSize`, `truncateTail`,
  `truncateToVisualLines`, `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`,
  `pi.on`, `pi.registerFlag`, `pi.getFlag`, `pi.registerTool`,
  `pi.getActiveTools`, `pi.setActiveTools`) are unchanged. The new
  additive fields on `SessionShutdownEvent` (`reason`,
  `targetSessionFile`) do not affect our handler. No extension code
  changes required; the devDep pin can be bumped at leisure. See
  [docs/DEV.md#checking-upstream-compatibility](docs/DEV.md#checking-upstream-compatibility)
  for the recipe used.

## 2026-04-20

### Changed

- **Prompt optimization**: LLM-visible tool prompts trimmed by ~56% (~384
  tokens saved per request). Tightened `description` strings, removed
  redundant `promptGuidelines`, and shortened parameter descriptions for
  `exec_command`, `write_stdin`, `kill_session`, and `list_sessions`. The
  `chars` escape table, `yield_time_ms` bounds, and `session_id` vs
  `exit_code` semantics are each now documented in a single canonical
  location instead of 3–4.
- **`exec_command` guidelines**: added a rephrased file-exploration hint —
  *"Prefer grep/find/ls tools over exec_command for file exploration
  (faster, respects .gitignore)."* This replaces the auto-added `bash`-
  targeted guideline that pi's `system-prompt.ts` stops emitting once the
  built-in `bash` tool is filtered out (the default under this extension).

### Fixed

- **Renderer parity with pi's built-in `bash`**: removed the
  `commandPreview` whitespace collapsing from `renderExecCommandCall` in
  `src/render.ts`. Multi-line commands (heredocs, multi-line `node -e` /
  `python3 -c`) now render verbatim in the `$ …` banner across multiple
  rows, matching
  `pi-mono/packages/coding-agent/src/core/tools/bash.ts:formatBashCall`.
