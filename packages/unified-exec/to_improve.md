# Areas to Improve

Source reviewed: latest `badlogic/pi-mono` clone at `local_data/pi-mono`,
commit `30298368` on `main`, with `@mariozechner/pi-coding-agent` and
`@mariozechner/pi-tui` release `0.73.0`.

Release notes checked:

- `local_data/pi-mono/packages/coding-agent/CHANGELOG.md`: `[Unreleased]`,
  `0.73.0`, `0.72.0`, `0.71.0`, and recent breaking-change sections.
- Relevant upstream APIs/docs: `local_data/pi-mono/packages/coding-agent/src/core/extensions/types.ts`,
  `local_data/pi-mono/packages/coding-agent/docs/extensions.md`, and
  `local_data/pi-mono/packages/coding-agent/src/core/tools/bash.ts`.

Compatibility status:

- Deprecated schema import resolved: this repo now imports `Type` from
  `typebox`, and package metadata uses `typebox` instead of
  `@sinclair/typebox`.
- Render context drift reduced: `src/render.ts` derives its local render
  context alias from pi's exported `ToolDefinition` type instead of copying the
  upstream `ToolRenderContext` shape.
- Shutdown metadata coverage added: tests cover all current upstream
  `session_shutdown` reasons (`quit`, `reload`, `new`, `resume`, `fork`) and
  verify that live sessions are terminated regardless of optional
  `targetSessionFile` metadata.

## 1. Pin Incremental Streaming Parity — RESOLVED (0.4.0)

Resolved: `tests/e2e.test.ts` now captures `onUpdate` through the harness and
asserts multiple growing partial outputs (with `session_id` in every partial)
during a long-running `exec_command`.

Pi 0.73.0 makes built-in `bash` output visible while commands run. unified-exec
already emits partial output through `onUpdate`, but the behavior should be
locked with a focused test.

Code references:

- `src/index.ts`: `OUTPUT_POLL_INTERVAL_MS`, `startStreaming()`,
  `runExecCommand()`, `runWriteStdin()`.
- `src/session.ts`: rolling output buffer used by streaming snapshots.
- `src/render.ts`: `renderResult()` consumes `details.output` during partial
  renders.
- `tests/e2e.test.ts`: harness currently passes `undefined` for `onUpdate`;
  extend it or add a dedicated test helper.
- Upstream reference: `local_data/pi-mono/packages/coding-agent/CHANGELOG.md`
  `0.73.0` "Incremental bash output streaming".

Lightweight plan:

- Add an e2e test that runs a multi-step command with `yield_time_ms` long
  enough for several poll ticks.
- Capture `onUpdate` calls in the harness and assert at least two increasing
  partial outputs before the final result.
- Repeat for `write_stdin` against a live stdin consumer if the first test
  exposes any differences between exec and follow-up polling.

Risk evaluation:

- Low behavioral risk because this should be test-only if current streaming is
  correct.
- Moderate flake risk because timing-based assertions can be brittle; use a
  command with clear delays and avoid exact millisecond expectations.

Verification gate:

- `node --import tsx --test tests/e2e.test.ts`
- `node --import tsx --test tests/*.test.ts`

## 2. Add Human Controls for Live Sessions — RESOLVED (0.4.0)

Resolved: the `/unified-exec-sessions` command lists live sessions in a
selector and kills the chosen one (or all), sharing the kill/escalate/drain
logic with the `kill_session` tool. Covered by three e2e tests.

The running-session widget makes live sessions visible after `/tree`, but users
still need the LLM-facing `kill_session`, `write_stdin`, or `list_sessions`
tools to act on them. A small command surface would make cleanup less dependent
on the model.

Code references:

- `src/index.ts`: `formatRunningSessionsWidget()`, `updateRunningSessionsUi()`,
  `watchSessionExit()`, `kill_session`, `list_sessions`.
- `src/session-store.ts`: `get()`, `remove()`, `terminateAll()`, LRU behavior.
- `tests/e2e.test.ts`: running-session footer/widget tests and kill/list
  session coverage.
- Upstream reference: `local_data/pi-mono/packages/coding-agent/docs/extensions.md`
  command and UI sections around `registerCommand()`, `ui.select()`, and
  widgets/status/footer.

Lightweight plan:

- Add a slash command such as `/unified-exec-sessions` that shows live sessions
  and lets the user kill one or all of them.
- Keep the command optional and UI-only; do not change the LLM tool contract.
- Reuse `SessionStore` methods rather than duplicating process-management
  logic.

Risk evaluation:

- Moderate UX risk: a command that kills sessions must make the selected target
  obvious to avoid terminating the wrong process.
- Low API risk if implemented entirely through existing extension command/UI
  APIs.
- Moderate test risk because command UI is harder to exercise with the current
  minimal harness.

Verification gate:

- Unit/e2e test for command registration and handler behavior with a stubbed
  selection result.
- `node --import tsx --test tests/e2e.test.ts`
- Manual interactive smoke test in pi: start a long-running session, run the
  command, kill it, and confirm the footer/widget clears.

## 3. Consider Working-Row and Editor Hooks Only for a Richer Shell UI

Pi now exposes `ctx.ui.setWorkingVisible()` and `ctx.ui.getEditorComponent()`.
They are useful for custom interactive surfaces, but unified-exec's current
tool-only design does not need them.

Code references:

- `src/index.ts`: current UI usage is limited to `ctx.ui.notify()`,
  `ctx.ui.setStatus()`, and optional `ctx.ui.setWidget()`.
- `src/render.ts`: custom tool call/result rendering already handles the
  visible unified-exec output.
- Upstream references:
  `local_data/pi-mono/packages/coding-agent/src/core/extensions/types.ts`
  `ExtensionUIContext.setWorkingVisible()` and `getEditorComponent()`;
  `local_data/pi-mono/packages/coding-agent/docs/extensions.md` widgets/status,
  working indicator, and editor wrapper sections.

Lightweight plan:

- Do not adopt these APIs for the current package surface.
- Revisit only if unified-exec adds a first-class interactive shell panel or
  custom editor integration.
- If revisited, prototype behind a flag so existing tool rendering remains the
  default.

Risk evaluation:

- High UX risk if used prematurely: hiding the working row or wrapping the
  editor could interfere with normal pi interaction.
- Low near-term implementation risk because the best action is to defer.

Verification gate:

- No code gate until a richer UI is actually implemented.
- If implemented later: Play through interactive pi sessions with and without
  the flag, including `/tree`, tool streaming, and session shutdown.

## 4. Preserve unified-exec's Session Model Instead of Replacing It With Bash

Pi's built-in `bash` now streams output incrementally, but it remains
command-scoped. unified-exec's main value is persistent `session_id`-addressable
processes.

Code references:

- `src/index.ts`: `exec_command`, `write_stdin`, `kill_session`,
  `list_sessions`, `startStreaming()`.
- `src/session.ts`: `ExecSession` owns long-lived process state and log paths.
- `src/session-store.ts`: live session inventory, LRU eviction, shutdown
  cleanup.
- `tests/e2e.test.ts` and `tests/e2e-pty.test.ts`: persistent session, PTY,
  interrupt, drain, and cleanup coverage.
- Upstream reference: `local_data/pi-mono/packages/coding-agent/src/core/tools/bash.ts`
  for built-in bash behavior and `local_data/pi-mono/packages/coding-agent/CHANGELOG.md`
  `0.73.0` streaming notes.

Lightweight plan:

- Keep unified-exec as a session-oriented extension.
- Borrow rendering/test expectations from built-in bash only where they improve
  parity without collapsing `exec_command`/`write_stdin` into one-shot bash.
- Document any future divergence explicitly in README if pi's bash gains more
  overlapping features.

Risk evaluation:

- High product risk if unified-exec becomes a thin bash wrapper; it would lose
  the long-lived REPL/dev-server/PTY workflow.
- Low maintenance risk in preserving the current architecture.

Verification gate:

- `node --import tsx --test tests/e2e.test.ts tests/e2e-pty.test.ts`
- Confirm tests still cover: yielded `session_id`, follow-up `write_stdin`,
  `kill_session`, lazy drain after exit, PTY interaction, and shutdown cleanup.

## 5. Avoid Stale Session-Bound Context Captures

Recent pi releases invalidate captured pre-replacement session-bound extension
objects after `newSession()`, `fork()`, and `switchSession()`. unified-exec does
not call those APIs, but any future command/UI work should avoid keeping stale
`pi` or command `ctx` objects for post-replacement work.

Code references:

- `src/index.ts`: module-level extension state in `ExtensionCtx`; event handlers
  update `ctx.ui` on `session_start`, `session_tree`, and tool execution.
- `tests/e2e.test.ts`: `session_shutdown` reason coverage for replacement
  paths.
- Upstream references:
  `local_data/pi-mono/packages/coding-agent/CHANGELOG.md` breaking change on
  stale `pi` / command `ctx`; `local_data/pi-mono/packages/coding-agent/docs/extensions.md`
  `withSession` migration guidance.

Lightweight plan:

- Keep only plain data and owned `SessionStore` state across callbacks.
- For any future command that calls `ctx.newSession()`, `ctx.fork()`, or
  `ctx.switchSession()`, do post-replacement work only inside upstream's
  `withSession` callback.
- Prefer refreshing UI handles from the current event/tool context, as the
  extension already does.

Risk evaluation:

- Moderate future risk: session-control commands are a natural extension of
  the package and could accidentally capture stale contexts.
- Low current risk because unified-exec does not initiate session replacement.

Verification gate:

- Static review for `newSession`, `fork`, `switchSession`, and stored command
  context references before adding session-control features.
- Tests for all `session_shutdown` reasons must continue passing:
  `node --import tsx --test tests/e2e.test.ts`.

## 6. Keep Peer Range Broad, Test Latest and Minimum When Narrowing

The package currently uses broad peer dependencies for pi extension installs
and exact dev dependencies for latest audited compatibility. If the peer range
is narrowed later, compatibility must be tested at both ends.

Code references:

- `package.json`: `peerDependencies` for
  `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, and `typebox`;
  exact dev pins for latest audited versions.
- `package-lock.json`: resolved dev dependency graph.
- `tests/truncate.test.ts`: pins behavior imported from
  `@mariozechner/pi-coding-agent`.
- `src/render.ts` and `src/index.ts`: public pi extension and TUI APIs consumed.

Lightweight plan:

- Keep peer ranges broad unless a real incompatibility is discovered.
- If narrowing, define a minimum supported pi version in README/package
  metadata and run tests against both that version and latest.
- Record the support decision in `Changelog.md`.

Risk evaluation:

- Broad peers reduce install friction but can allow untested old pi versions.
- Narrow peers improve predictability but may make project-local pi package
  installs harder for users on older agents.

Verification gate:

- Current latest gate: `npx tsc --noEmit` and
  `node --import tsx --test tests/*.test.ts`.
- Future minimum-version gate: reinstall dev dependencies at the declared
  minimum pi version, then rerun the same typecheck and test suite.
