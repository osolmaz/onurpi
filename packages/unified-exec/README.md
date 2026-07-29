# unified-exec

[![npm version](https://img.shields.io/npm/v/pi-unified-exec.svg?logo=npm&label=npm)](https://www.npmjs.com/package/pi-unified-exec)
[![npm downloads](https://img.shields.io/npm/dm/pi-unified-exec.svg)](https://www.npmjs.com/package/pi-unified-exec)
[![License](https://img.shields.io/npm/l/pi-unified-exec.svg)](./LICENSE)
[![CI](https://github.com/iamwrm/pi-unified-exec/actions/workflows/ci.yml/badge.svg)](https://github.com/iamwrm/pi-unified-exec/actions/workflows/ci.yml)
[![Publish to npm](https://github.com/iamwrm/pi-unified-exec/actions/workflows/publish.yml/badge.svg)](https://github.com/iamwrm/pi-unified-exec/actions/workflows/publish.yml)

A pi extension that ports codex's `unified_exec` session model: every bash
command becomes a long-lived session the LLM drives with writes and polls,
instead of a single blocking call the agent waits on.

Mirrors codex's `exec_command` + `write_stdin` tool surface, with small
pi-flavor additions (`set_on_exit`, `kill_session`, `list_sessions`).

> **Install:**
> ```bash
> pi install npm:pi-unified-exec
> ```

## Highlights

- **Session-oriented, two-way I/O.** `exec_command` opens a long-lived
  session; the LLM keeps the `session_id` and drives the same process
  across turns by interleaving `write_stdin` writes and polls. Every
  byte the child prints is mirrored to an on-disk log file in parallel
  with the in-memory buffer, so the full history is recoverable via
  `read(log_path)` even after the LLM-visible tail truncates.
- **Bounded waits — the agent never stalls.** Every tool call returns
  within a hard ceiling: 30 s for `exec_command` and interactive
  `write_stdin`, 290 s for pure background polls (`yield_time_ms`). For a
  human-requested long attached wait, `yield_until` stays attached until an
  absolute UTC deadline (no default max horizon; multi-day waits re-arm
  timers safely). A long-running process keeps running; the agent just gets
  control back with a `session_id` and can poll again when it chooses.
- **Completion can resume the agent (opt-in).** `exec_command(on_exit: "wake")`
  (default is `"none"`) delivers exactly one follow-up model prompt (bounded
  exit metadata, no raw output) when a backgrounded process exits while
  nothing is observing it — completions seen directly by a tool result
  consume the wake instead. `set_on_exit` disarms or re-arms wake without
  killing the process (including coordinator tombstones after eviction);
  `list_sessions` and the running-session UI surface `wake_armed` / `⏰wake`.
- **Ctrl-C and other control bytes, not just stdin text.**
  `write_stdin` decodes C-style escapes (`\x03` Ctrl-C, `\x04` EOF,
  `\x1b[A` arrow-up, …) before writing, so the LLM can interrupt a
  stuck command or drive an interactive TUI — `chars_b64` covers the
  arbitrary-binary case.

## Why

Pi's built-in `bash` tool blocks until the process exits. For a dev server,
`tail -f`, a REPL, or anything interactive, the agent either has to set a huge
timeout and burn context waiting, or it times out and loses the process.

Codex's alternative: every call opens a session, yields after a bounded
`yield_time_ms` with output-so-far plus a `session_id`, and the LLM polls or
drives the session on later turns via `write_stdin(session_id, chars, …)`. A
PTY is available for interactive programs (Python REPL, ssh, sudo, TUIs).

This extension is a faithful port of that design, with codex's constants
preserved.

## Install

Published on npm as [`pi-unified-exec`](https://www.npmjs.com/package/pi-unified-exec).
Install via pi's package manager:

```bash
pi install npm:pi-unified-exec            # global (~/.pi/agent/settings.json)
pi install -l npm:pi-unified-exec         # project-local (.pi/settings.json)
```

`pi install` runs `npm install` under the hood, which fetches
`@homebridge/node-pty-prebuilt-multiarch` (prebuilt binaries for
linux/macOS/Windows — no compilation). If the install fails on your
platform, pipe mode (`tty: false`) still works, but PTY mode (`tty: true`)
will error with a clear message.

To try without installing:

```bash
pi -e npm:pi-unified-exec
```

Reload a running pi with `/reload`.

## Tools

### `exec_command`

Runs a command in a persistent session.

| Param | Type | Default | Notes |
|---|---|---|---|
| `cmd` | string | — | Shell command. Required. |
| `workdir` | string | turn cwd | Working directory. |
| `shell` | string | `bash` | Shell binary. On Windows: `bash` if on PATH, else `powershell`. `cmd` / `powershell` / `pwsh` get shell-appropriate flags. |
| `tty` | boolean | `false` | Allocate a PTY (requires node-pty). |
| `yield_time_ms` | number | `10_000` | How long this call stays attached waiting for output (an attachment window, not the command's lifetime), clamped to [250, 30_000]. |
| `on_exit` | `"none"` \| `"wake"` | `"none"` | Persistent per-session policy for exits nobody is observing. Prefer `"none"`. `"wake"`: one synthetic follow-up prompt resumes the agent — only when the human explicitly wants auto-resume. Change later with `set_on_exit`. |

Response body (short output, no truncation):

```
[still running]                     (or [exited])
session_id: 1                       (mutually exclusive with exit_code)
exit_code: 0                        (mutually exclusive with session_id)
signal: SIGTERM                     (optional, if killed)
log_path: /tmp/pi-unified-exec-1-5cc5e104.log
cwd: /home/you/project
wall_time_seconds: 0.502
chunk_id: a4f2c1
original_token_count: 37
tty: false
---
<captured stdout+stderr>
```

When output exceeds the caps (50 KiB / 2000 lines), a footer is appended:

```
...tail of output...

[Showing lines 3900-4120 of 4500 (50.0KB limit). Full output: /tmp/pi-unified-exec-1-5cc5e104.log]
```

### `write_stdin`

Drives or polls an existing session.

| Param | Type | Default | Notes |
|---|---|---|---|
| `session_id` | number | — | Required. |
| `chars` | string | `""` | Empty = pure poll; non-empty writes (after escape decoding) then polls. Mutually exclusive with `chars_b64`. |
| `chars_b64` | string | `""` | Base64-encoded bytes to write. Binary-safe. Mutually exclusive with `chars`. |
| `yield_time_ms` | number | `250` | Attachment/progress window (not a process timeout). Clamped [250, 30_000] with input. Empty polls clamped [5_000, 290_000]; **values above the cap are rejected** with an error that includes the current host UTC time (`tool_time_utc`). Mutually exclusive with `yield_until`. |
| `yield_until` | string | — | Absolute UTC deadline for an **empty poll only**, strict RFC 3339 UTC (`2026-07-21T18:30:00Z` or with `.mmm`; uppercase `Z`; no offsets/local time; real calendar dates only). **Only when the human explicitly asks** for a long attached wait — not a shortcut around the 290 s cap. The call stays attached until the process exits, the call is cancelled, or the deadline arrives — whichever is first. A past deadline is an immediate poll. No default max horizon. Mutually exclusive with `yield_time_ms` and with input bytes. |

#### Waiting on long-running commands — the rules

1. Use `yield_time_ms` for interaction or an empty progress poll of at most
   290 seconds (cache-friendly; stays under Anthropic's 5-minute
   prompt-cache TTL). Repeat polls as needed.
2. Use `yield_until` **only when the human explicitly asks** for a long
   attached wait or a wall-clock deadline on a **finite, non-interactive**
   command. Do **not** use it just to bypass the 290 s cap. Omit
   `yield_time_ms` and pass a future UTC timestamp ending in `Z` (compute
   from `tool_time_utc`). The call still returns immediately when the
   process exits; Esc never kills the process.
3. `on_exit` defaults to `"none"`. Use `"wake"` **only when the human
   explicitly wants** auto-resume on unobserved completion. If you armed
   wake by mistake or the job is abandoned, call
   `set_on_exit(session_id, on_exit: "none")` promptly (does not kill).
4. Combining wake with an observing `write_stdin` is safe: a completion
   observed directly by a tool result consumes the wake; a deadline or
   cancellation leaves the wake armed until disarmed or delivered.

**Never** use `yield_until` for REPLs, `sudo`, `ssh`, password prompts,
dev servers, file watchers, debuggers, or any indefinite/interactive
session — it is only for finite commands that exit on their own.

During an absolute wait, the session machinery keeps working normally: the
bounded head/tail buffer retains output, the rolling TUI tail updates (rate
limited — no 250 ms heartbeat for hours), and every byte still lands in the
log file. Internally the wall-clock deadline is converted once to a
monotonic deadline, so NTP adjustments or manual clock changes cannot
stretch or shrink an in-progress wait.

#### Wait/cap configuration

| Env var | Default | Notes |
|---|---|---|
| `PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS` | `290_000` | Cap for empty `write_stdin` polls. May be **lowered** but never raises the effective cache-friendly maximum above 290 s. Positive values below `5_000` are raised to `5_000`; invalid values use the default. |

#### Control bytes and escapes in `chars`

`chars` is decoded as a C-style escape string before being written to stdin.
This lets the LLM send control bytes the wire format (antml/JSON tool_use)
strips of their meaning otherwise.

| Escape | Produces |
|---|---|
| `\\n` `\\r` `\\t` `\\b` `\\f` `\\v` | LF CR TAB BS FF VT |
| `\\0` | NUL (0x00) |
| `\\a` | BEL (0x07) |
| `\\e` | ESC (0x1B) |
| `\\xHH` (2 hex) | single byte |
| `\\uHHHH` (4 hex) | Unicode char |
| `\\u{H…H}` (1–6 hex) | Unicode code point |
| `\\\\` `\\"` `\\'` | literal `\` `"` `'` |
| `\\X` not in the list above | preserved literally (both chars) |
| Raw bytes in the string | pass through untouched |

Examples:

```
write_stdin chars="\x03"          → Ctrl-C   (0x03)
write_stdin chars="\x04"          → Ctrl-D   (0x04)
write_stdin chars="\x1b:wq\n"     → ESC + ":wq" + LF     (vim save+quit)
write_stdin chars="\x1b[A"        → ESC + "[A"           (up arrow)
write_stdin chars="password\n"    → "password" + LF
write_stdin chars="C:\\\\temp"    → "C:\\temp"           (must escape \)
```

For arbitrary binary or when you want zero ambiguity, use `chars_b64`
instead:

```
write_stdin chars_b64="G3s6wgo="    → exact 5 decoded bytes
```

The two parameters are mutually exclusive — passing both rejects the call.
Malformed base64 also rejects.

### `set_on_exit`

Change `on_exit` policy **without killing the process**.

| Param | Type | Default | Notes |
|---|---|---|---|
| `session_id` | number | — | Required. |
| `on_exit` | `"none"` \| `"wake"` | — | `"none"`: disarm pending wake (process keeps running; also works for coordinator tombstones after store eviction). `"wake"`: arm auto-resume if still running in the store. Too late once the session has already exited unregistered / already notified. |

Status tokens in the result: `disarmed`, `already_none`, `armed`,
`already_armed`, `too_late`. Unknown ids return `found: false`.

Use this when wake was armed by mistake, the approach was abandoned, or the
human no longer wants auto-resume. **Disarm cannot recall a follow-up that
was already queued to pi.** `kill_session` still both kills and suppresses
wake.

### `on_exit: "wake"` — completion notifications

Default is `"none"`. `exec_command(on_exit: "wake")` arms a per-session
completion policy once the call commits to returning a background
`session_id` (a command that finishes inside the initial yield returns its
exit directly and never arms a wake). Prefer arming only when the human
explicitly wants auto-resume; use `set_on_exit` to disarm later.

The exactly-once invariant:

> Terminal completion is delivered through a finalized tool result **or**
> it causes one synthetic model prompt — normally never both.

Mechanics:

- Any `write_stdin` call that could return terminal status takes an
  *observation lease*. An exit that lands while an observer is attached is
  held and returned directly by that call; the wake is consumed when pi
  finalizes the tool result (`tool_execution_end`). A result finalized as
  error/cancelled releases the lease and keeps the wake eligible.
- A relative/absolute deadline or a cancelled call releases the lease and
  leaves the wake armed; when the process later exits, exactly one
  follow-up prompt is sent.
- The prompt is delivered via `pi.sendMessage(…, { triggerTurn: true,
  deliverAs: "followUp" })`: it starts a turn if pi is idle and is queued
  as a follow-up if a run is active — it never steers or interrupts the
  current turn. Simultaneous completions are debounced into **one** bounded
  prompt.
- The prompt contains bounded execution metadata only (session id, exit
  code/signal, sanitized one-line command, cwd, elapsed time, log path,
  failure info) — never raw stdout/stderr. The exited session remains
  drainable via an empty `write_stdin` afterwards, and consuming that
  output never triggers a second wake.
- Suppression: `kill_session`, the `/unified-exec-sessions` command, LRU
  eviction of a live process, and `session_shutdown` all suppress the wake
  (before signaling). A kill that fails to land restores eligibility. A
  naturally-exited wake session that gets evicted before notification keeps
  a bounded tombstone snapshot so its one wake (with `log_path`) is still
  delivered — unless `set_on_exit … none` disarms that tombstone by id.
  `list_sessions` reporting the exit first counts as direct observation and
  suppresses a not-yet-queued wake.

Requires pi ≥ 0.80.5 (`agent_settled` extension event, used as a safe flush
point for pending/retried notifications).

### `kill_session`

Pi-flavor. Not in codex.

| Param | Type | Default | Notes |
|---|---|---|---|
| `session_id` | number | — | Required. |
| `signal` | string | `"SIGTERM"` | Escalates to SIGKILL after 2s. Pass `"SIGKILL"` to skip the grace. On Windows any signal force-kills the process tree immediately. |

Signal names are normalized (`term`, `INT`, `sigkill` all work). Unknown
names are rejected with an error instead of silently no-opping.

### `list_sessions`

Pi-flavor. Not in codex. Prunes exited sessions from the in-memory store, but
reports each of them one final time (with `running: false`, `exit_code` /
`signal`, and `log_path`) so exit information is never silently lost.

Each entry includes **`wake_armed: boolean`** (and the text listing marks
live armed sessions with `wake`) so the model can audit which sessions will
auto-resume on unobserved exit.

## Command

- `/unified-exec-sessions` — human-facing escape hatch: lists live sessions in
  a selector (armed wakes show `⏰wake`) and kills the chosen one (or all of
  them) without going through the model. Uses the same SIGTERM → 2s → SIGKILL
  escalation as `kill_session`.

## Flag

By default, this extension **removes pi's built-in `bash` tool** from the
active set at session start so the LLM is steered toward `exec_command` /
`write_stdin`.

- `--keep-builtin-bash` — preserve the built-in `bash` alongside the
  unified-exec tools. Useful if you've got skills or prompts that explicitly
  expect `bash(cmd, timeout)`.

## TUI rendering

Custom `renderCall` and `renderResult` mirror pi's built-in `bash` tool
styling and add session-aware details:

**While streaming (live, updates every second):**
```
$ for i in {1..12}; do echo round $i; sleep 0.5; done (yield 2.5s · cwd: ~/project)
… 1 earlier lines
  round 2
  round 3
  round 4
  round 5

  elapsed 1.3s · session_id=2 · log: /tmp/pi-unified-exec-2-86b3f006.log
```

**After yield, session still alive:**
```
  yielded 2.5s · session_id=2 · log: /tmp/pi-unified-exec-2-86b3f006.log
```

**After process exits:**
```
  took 4.2s · exit_code=0 · log: /tmp/pi-unified-exec-1-5cc5e104.log
```

**write_stdin:**
```
⟳ poll → session_id=2 (yield 5.0s)               # empty chars
⟳ poll → session_id=2 (2h40m later)              # yield_until (live remaining)
» print(7*6)\n → session_id=1 (yield 1.0s)         # with input
» ^C → session_id=1 (yield 1.0s)                  # control byte
» (base64, 5 bytes) → session_id=1 (yield 1.0s)   # chars_b64 payload
```

**Absolute-wait footer** (while still attached) shows remaining time such as
`2h40m later` (ISO deadline stays in tool details for the model). Cancelled
waits mark `cancelled`; armed wakes may show `wake armed`.

**set_on_exit:**
```
set_on_exit session_id=2 → none
```

**Running-session UI:** while any unified-exec process is still alive, the TUI
footer shows `unified-exec: N sessions running`. After `/tree` navigation, a
widget above the editor lists the live `session_id`s and commands (with
`⏰wake` when auto-resume is armed) so the human sees that processes survived
branch navigation. The footer/widget refreshes as soon as a background session
exits; the exited session remains drainable via `write_stdin` until observed,
preserving the usual lazy cleanup semantics.

By design this display omits some metadata the LLM sees (chunk_id,
original_token_count, full log path if tildified) — use `Ctrl+O` on the tool
row to expand the full captured output.

## Constants

Codex-parity unless noted:

```
MIN_YIELD_TIME_MS            = 250
MAX_YIELD_TIME_MS            = 30_000
MIN_EMPTY_YIELD_TIME_MS      = 5_000
DEFAULT_EXEC_YIELD_MS        = 10_000
DEFAULT_WRITE_STDIN_YIELD_MS = 250
EARLY_EXIT_GRACE_PERIOD_MS   = 150
HEAD_TAIL_MAX_BYTES          = 1 MiB   (in-memory drain buffer)
MAX_SESSIONS                 = 64
WARNING_SESSIONS             = 60
LRU_PROTECTED_COUNT          = 8

# Diverges from codex — codex allows 30 min; capped at 290 s to stay under
# Anthropic's 5-minute prompt-cache TTL. The env override can only LOWER it;
# longer waits use write_stdin's yield_until (absolute deadline):
DEFAULT_MAX_BACKGROUND_POLL_MS = 290_000  (env: PI_UNIFIED_EXEC_MAX_EMPTY_POLL_MS, lower-only)
LONG_WAIT_UPDATE_INTERVAL_MS   = 30_000  (rate limit for absolute-wait TUI updates)
MAX_TIMER_ARM_MS               = 2^31-1   (setTimeout chunk size for multi-day yield_until)

# Diverges from codex — matches pi's built-in bash instead:
DEFAULT_MAX_BYTES            = 50 KiB  (LLM-visible per-call truncation cap)
DEFAULT_MAX_LINES            = 2000
OUTPUT_POLL_INTERVAL_MS      = 250     (pi-specific: onUpdate cadence)
PREVIEW_LINES                = 5       (TUI preview lines before ctrl+o expand)
```

## Semantic notes

- **Early exit**: commands that finish in <150 ms never touch the session
  store. The response has `exit_code`, no `session_id`.
- **Session persistence between calls**: if a process exits after a tool call
  returns but before the next one, the session stays in the store. The next
  `write_stdin(session_id, …)` call will observe the exit and return
  `exit_code`, then remove the session; `list_sessions` reports it once with
  exit info before removing it. (Matches codex's `refresh_process_state`
  pattern.)
- **Spawn failures are diagnosable**: a nonexistent shell binary or `workdir`
  (async ENOENT from the OS) surfaces as `failure_message` in the response
  instead of a silent empty exit.
- **Closed stdin is safe**: a child that closes its stdin no longer crashes
  the host on EPIPE; follow-up `write_stdin` calls report
  `failure_message: "stdin write failed: …"` when bytes can't be delivered.
- **External abort (Esc)**: breaks the current call's wait but does not kill
  the session. The next turn can still drive it. For `yield_until` waits the
  cancelled call reports `wait_status: cancelled`, does not drain buffered
  output, and leaves an armed `on_exit: "wake"` eligible.
- **Absolute wait races**: if exit, cancellation, and deadline land almost
  simultaneously, actual process exit wins whenever the session is already
  terminal when the result is assembled.
- **Session shutdown**: all live sessions are terminated with SIGTERM; after a
  1s grace, survivors (e.g. children that trap SIGTERM) are SIGKILLed so
  detached process groups don't outlive pi. (Use the separate
  `bash-background` extension if you need true disown.)
- **LRU eviction**: at `MAX_SESSIONS`, the oldest non-protected session is
  evicted. The 8 most-recently-used are never pruned. Exited sessions are
  preferred as victims.
- **Head+tail output buffer**: per session, up to 1 MiB retained, split 50/50
  between the beginning and end of the output stream. A separate 32 KiB
  rolling tail window feeds streaming `onUpdate` events during waits.

## Architecture

```
src/
├── index.ts              # tool registration, event handlers, flag
├── session.ts            # ExecSession: spawn, read, write, kill, log-stream, state
├── session-store.ts      # SessionStore + LRU eviction (matches codex)
├── head-tail-buffer.ts   # direct port of codex's HeadTailBuffer
├── collect.ts            # collectOutputUntilDeadline
├── long-wait.ts          # event-driven absolute (yield_until) wait + rate-limited streaming
├── time.ts               # strict RFC 3339 UTC parsing for yield_until
├── format-time.ts        # shared elapsed / remaining human labels
├── completion.ts         # CompletionCoordinator: on_exit "wake" scheduling (exactly-once)
├── notify.ts             # Notify / Gate / sleep primitives
├── pty.ts                # node-pty loader + pipes fallback + Windows tree-kill
├── shell.ts              # shell selection & argv construction (Windows-aware)
├── render.ts             # renderCall / renderResult for the TUI
└── unescape.ts           # C-style escape decoder for write_stdin `chars`
```

Workspace docs (agent memory, not runtime):

```
docs/
├── DC-0001-agentic-workspace.md              # IV/DC doctrine
├── IV-0001-long-wait-and-wake-control.md     # long-wait / wake initiative
└── DEV.md                                    # contributor onboarding
```

## Worked examples

### 1. Dev server (never exits on its own)

```
> exec_command(cmd="npm run dev", yield_time_ms=5000)
[still running]
session_id: 1
---
> Server listening on :3000

> exec_command(cmd="curl -s localhost:3000/health", yield_time_ms=2000)
[exited]
exit_code: 0
---
{"ok": true}

> write_stdin(session_id=1, chars="", yield_time_ms=10000)      # poll dev server
[still running]
---
  GET /health 200 in 3ms

> kill_session(session_id=1)                                    # stop it
Killed session 1 (pid 12345) with SIGTERM — exit_code=143
```

### 2. Long-running non-interactive job

```
> exec_command(cmd="npm test", yield_time_ms=1000, on_exit="wake")
[still running]
session_id: 2
completion_notification: armed
tool_time_utc: 2026-07-21T08:30:00.000Z
---
> test suite started

> write_stdin(session_id=2, yield_until="2026-07-21T10:30:00Z")  # only if human asked for long attach
[exited]
exit_code: 0
wait_mode: absolute
wait_status: completed
completion_delivery: direct
on_exit_wake: consumed
---
> all tests passed

# If the job is abandoned before exit:
> set_on_exit(session_id=2, on_exit="none")   # disarm; process keeps running
set_on_exit session_id=2 on_exit=none → disarmed …; wake not armed

> list_sessions()
# live armed sessions include wake_armed: true / "wake" in the text listing
```

Prefer repeated `yield_time_ms` ≤ 290 s polls for ordinary progress. Use
`yield_until` only when the human explicitly wants a long attached wait. If
the deadline arrives (or the wait is cancelled) while the process is still
running and wake is still armed, one follow-up prompt is delivered when the
process exits — unless you `set_on_exit … none` first.

### 3. Interactive Python REPL

```
> exec_command(cmd="python3 -q", tty=true, yield_time_ms=1500)
[still running]
session_id: 1
---
>>>

> write_stdin(session_id=1, chars="print(7*6)\r", yield_time_ms=1000)     # \r = Enter (portable; \n fails on Windows)
[still running]
---
42
>>>

> write_stdin(session_id=1, chars="exit()\r", yield_time_ms=1000)
[exited]
exit_code: 0
```

### 4. `sudo` (interactive password)

```
> exec_command(cmd="sudo -k && sudo whoami", tty=true, yield_time_ms=1500)
[still running]
session_id: 1
---
[sudo] password for wr:

> write_stdin(session_id=1, chars="<password>\r", yield_time_ms=2000)
[exited]
exit_code: 0
---
root
```

## Tests

From the repo root:

```bash
npm install
npx tsx --test tests/*.test.ts
```

Tests cover yield_until timestamp validation (strict RFC 3339 UTC subset,
impossible-date rejection, far-future acceptance, `tool_time_utc` on errors),
event-driven long-wait behavior (monotonic re-arm, multi-day timer chunking,
cancellation, timer/listener cleanup, rate-limited streaming with no idle
heartbeat), the CompletionCoordinator (exactly-once invariant, observation
leases, `setOnExit` disarm/re-arm including tombstones, kill/eviction/shutdown
suppression, batching, bounded sanitized wake content), wake + yield_until +
`set_on_exit` + `wake_armed` listing integration through the real tools, plus
the pre-existing
coverage: HeadTailBuffer (direct port of codex's unit
tests), Notify/Gate/sleep, collectOutputUntilDeadline (10 scenarios incl.
abort-listener/timer cleanup), SessionStore LRU (10 scenarios), truncateTail
(ported from pi, 13 scenarios), unescapeChars (14 scenarios for
`\xHH`/`\uHHHH`/`\u{…}`/unknown escapes/Windows path footguns),
chars-encoding end-to-end (13 scenarios covering raw bytes, escape decoding,
chars_b64 binary-safety, and mutual-exclusion errors), signal-name mapping,
full e2e pipes (35+ scenarios incl. log-file retention, byte/line truncation,
spawn-failure diagnostics, EPIPE safety, exited-session reporting, shutdown
SIGKILL escalation, onUpdate streaming, and the `/unified-exec-sessions`
command), PTY mode (3 scenarios: simple command, Python REPL drive, Ctrl-C
injection, cmd.exe verbatim payload), shell selection (per-shell argv
construction, PATH lookup with synthetic PATH fixtures, Windows
bash→powershell fallback both branches, WSL-stub exclusion, binary
resolution caching), PTY loader guard (EXPECT_PTY assertion so a prebuild
load failure is a red build, ConPTY disposal mock), and cmd.exe quoting
e2e (operators, embedded quotes, %VAR%, parentheses, pipes).

CI runs the suite on ubuntu, macos, and windows runners.

## Improvements over codex

This port preserves codex's session semantics but borrows two pieces from pi's
built-in `bash` tool that codex itself treats as unsolved:

**1. Full output retained on disk, not just head+tail in memory.**
Codex caps each session's in-memory buffer at 1 MiB and silently drops middle
bytes once it fills. We mirror every byte the child writes to
`/tmp/pi-unified-exec-<sid>-<random>.log` in parallel with the in-memory
buffer. The file has the complete, unaltered stream across the entire
session's lifetime; nothing is lost.

**2. LLM-visible output is tail-capped at pi's `bash` defaults (50 KiB or
2000 lines, whichever hits first), with a pointer to the log file.**
Codex serializes up to ~40 KiB to the LLM on every call (10 000 tokens of
middle-truncated text). That's a bounded-but-generous context cost per call,
and codex gives the LLM no way to recover the dropped middle. Our port
tail-truncates per pi's `bash` tool and exposes `log_path` in the response
header and tool-call details. When the LLM wants the full output it can
`read(log_path)` with pi's file-read tool.

As a consequence we dropped codex's `max_output_tokens` parameter on both
`exec_command` and `write_stdin`. The per-call cap is fixed; if the LLM
wants a tighter snippet it can ask for a specific slice by reading from the
log file.

| | codex | this port |
|---|---|---|
| Session in-memory retention | 1 MiB head+tail (lossy) | 1 MiB head+tail (lossy) — same |
| **Session full retention** | **none** | **full log file on disk** |
| LLM-visible per call | ≤40 KiB, middle-truncated | ≤50 KiB / ≤2000 lines, tail-truncated |
| LLM-visible truncation recovery | none | `read(log_path)` for the full stream |
| Per-call `max_output_tokens` knob | yes (default 10 000) | removed; fixed 50 KiB/2000 lines |
| Truncation marker in body | `…N tokens truncated…` | `[Showing lines X-Y of T. Full output: …]` |

The `log_path` field is exposed in every `exec_command` and `write_stdin`
response (as a header line and in tool-call details), plus in `list_sessions`
per-entry and in `kill_session` details.

Log files live in `/tmp/` and are never auto-deleted (they're just regular
files; `/tmp` cleanup is the OS's problem). If you run the same session to
completion and never revisit the log, it'll linger until your next reboot.

## Other pi-flavor additions

- `set_on_exit`, `kill_session`, and `list_sessions` tools (codex has none of
  these). `list_sessions` exposes `wake_armed`; the running-session widget and
  `/unified-exec-sessions` picker mark armed wakes with `⏰wake`.
- `write_stdin` also works in pipe mode (`tty: false`), not just PTY.
  Useful for feeding lines to `jq`, `sort`, etc.
- Streaming `onUpdate` tail window for TUI rendering during yields, plus
  human remaining-time labels for `yield_until` waits.
- Running-session UI: footer status while processes are alive and a
  post-`/tree` widget so humans can see that processes survived branch
  navigation. The UI refreshes immediately on background session exit without
  pruning the exited session before the next `write_stdin`/`list_sessions`.
- Rich `renderCall` / `renderResult` mirroring pi bash's styling: command
  banner with `(yield Ns · cwd: …)` suffix, 5-line collapsed preview with
  `ctrl+o` expand, live "elapsed" counter, `yielded`/`took`/`exit_code`
  status footer, and a `⟳ poll` / `» input` banner for `write_stdin`.
- `cwd`, `command`, and `yield_time_ms` are surfaced in tool-call details
  (and `cwd` in the LLM-visible response header) for easy debugging.

## What's not here (vs codex)

- No sandbox / approval / permission stack (pi doesn't have one).
- No network-proxy integration.
- No persistence across pi restarts. (Processes are terminated on
  `session_shutdown`.)
- No PTY resize (SIGWINCH) handling.

## Windows

Supported — both pipes and PTY mode:

- **PTY (`tty: true`) uses ConPTY** via `@homebridge/node-pty-prebuilt-multiarch`
  (win32 prebuilds — no compilation).
- **Default shell**: `bash`, located with an extended probe (first hit
  wins, cached):
  1. `PI_UNIFIED_EXEC_BASH` env var (explicit override)
  2. `bash` on PATH — System32's `bash.exe` (the WSL stub) is deliberately
     excluded: it runs commands inside a WSL distro's filesystem view, not
     Windows'
  3. **derived from `git.exe` on PATH** — Git for Windows' default
     installer puts only `Git\cmd` (git.exe) on PATH, not `Git\bin`, so
     "git works but bash doesn't" is the most common setup; the probe
     walks up from git.exe and finds `<GitRoot>\bin\bash.exe`
  4. well-known install roots (`%ProgramFiles%\Git`, `%ProgramW6432%\Git`,
     `%ProgramFiles(x86)%\Git`, `%LocalAppData%\Programs\Git`)
  5. `powershell` fallback, with a one-time warning

  When bash is found off PATH (steps 3–4), a one-time info notice shows the
  path being used. Derived hits use `bin\bash.exe` — Git's launcher, which
  sets up MSYS PATH so `ls`/`grep`/`sed` work in the child — never
  `usr\bin\bash.exe`. Explicit `shell: "bash"` gets the same extended
  probe. Explicit `shell: "cmd"` (`/d /s /c`, verbatim command line —
  works in both pipe and tty mode) and `shell: "powershell"` / `"pwsh"`
  (`-NoProfile -Command`) are supported. Bare shell names are resolved to
  an absolute path before spawning (failing closed if unresolvable), so a
  binary planted in an untrusted workdir can't shadow the real shell.
- **No POSIX signals.** Every kill — `kill_session`, `/unified-exec-sessions`,
  LRU eviction, `session_shutdown` — is a force tree-kill
  (`taskkill /pid <pid> /T /F`), regardless of the requested signal name.
  Killed processes report `exit_code: 1` rather than `signal: SIGTERM`, and
  escalation-to-SIGKILL never happens (the first kill is already final).
  Tree-kill matters: killing only the shell would orphan grandchildren, which
  also hold the stdio pipes open and delay exit detection.
- **Log files** live in `%TEMP%` (`os.tmpdir()`), same naming scheme.
- **Kill failures are reported, not hidden.** If `taskkill` doesn't land
  (access denied, protected process), `kill_session` says so and the session
  stays registered for retry — it is never silently dropped while the
  process lives.
- **Supply-chain note (PTY prebuilds).** npm's lockfile integrity covers the
  `@homebridge/node-pty-prebuilt-multiarch` JS payload, but the native
  ConPTY binary is fetched at install time by `prebuild-install` from the
  package's GitHub releases (TLS, homebridge org) — those bytes are not
  covered by an npm digest. The dependency is pinned exactly; if your threat
  model requires more, vendor the prebuild or build node-pty from source.
- Ctrl-C injection (`write_stdin chars="\x03"`) works in PTY mode — ConPTY
  translates it into a real console interrupt. In pipe mode it's just a byte,
  as on every platform.
- **Submit tty input with `\r`, not `\n`.** POSIX terminals map CR→NL so
  both work there, but legacy Windows console line input only executes on
  CR — with `\n` a REPL echoes the text without running it.
  `write_stdin chars="print(6*7)\r"` is portable; `\n` is not.

## Source map vs codex

| unified-exec (TS) | codex (Rust) |
|---|---|
| `src/head-tail-buffer.ts` | `codex-rs/core/src/unified_exec/head_tail_buffer.rs` |
| `src/collect.ts` | `codex-rs/core/src/unified_exec/process_manager.rs::collect_output_until_deadline` |
| `src/notify.ts` (Notify/Gate) | tokio `Notify` + `watch::Sender<bool>` |
| `src/session.ts` | `codex-rs/core/src/unified_exec/process.rs::UnifiedExecProcess` |
| `src/session-store.ts` | `codex-rs/core/src/unified_exec/process_manager.rs::ProcessStore` |
| `src/pty.ts` | `codex-rs/utils/pty` (pty.rs + pipe.rs) |
| `truncateTail` from `@earendil-works/pi-coding-agent` | (no equivalent in codex) — pi bash's tail truncator |
| `src/unescape.ts` | (no equivalent in codex) — C-style escape decoder for `chars` |
| `src/render.ts` | (no equivalent in codex) — pi TUI renderCall / renderResult |
| `src/index.ts` exec_command handler | `codex-rs/core/src/tools/handlers/unified_exec.rs` |

---

## Contributing / hacking

See [docs/DEV.md](docs/DEV.md) for the full maintainer guide:
onboarding, repo layout, dev loop, test recipes, release workflow
(npm publish via GitHub Actions Trusted Publisher), debugging aids,
and the codex-side sources to consult before changing core behavior.
