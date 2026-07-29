# Development

Onboarding guide for hacking on this extension. For end-user install
and tool reference, see [../README.md](../README.md).

## Prerequisites

- **Node ≥ 22.19** (see `package.json` `engines`; we use `AbortSignal`,
  `fetch`, native ESM with `.ts` imports via
  [tsx](https://github.com/privatenumber/tsx)).
- **Linux, macOS, or Windows.** On Windows, Git Bash is strongly
  recommended (it's the default shell when on PATH; otherwise commands
  fall back to `powershell`). PTY mode uses ConPTY via the
  `@homebridge/node-pty-prebuilt-multiarch` win32 prebuilds.
- **pi** installed and runnable (`pi --version`). End users install with
  `pi install npm:pi-unified-exec`; for development you want a local clone
  of this repo (see below).

## First-time setup

Clone the repo and install dev dependencies:

```bash
git clone https://github.com/iamwrm/pi-unified-exec
cd pi-unified-exec
npm install
```

To have pi load your working copy for interactive testing, either symlink it
into pi's auto-discovery path:

```bash
ln -s "$PWD" .pi/extensions/unified-exec      # from the project you want it in
```

or install directly from the local path (writes into pi's settings):

```bash
pi install -l ./path/to/pi-unified-exec
```

`npm install` fetches `@homebridge/node-pty-prebuilt-multiarch` prebuilds. If your
platform has no prebuild the optional dep fails silently — pipe mode
(`tty: false`) still works; only `tty: true` will error with a clear
message at call time.

Verify the install:

```bash
npx tsc --noEmit                    # clean typecheck
npx tsx --test tests/*.test.ts      # all tests (~10–15s)
```

You should see on the order of **250+** tests with `fail 0` (a few skipped on
non-Windows or when no real `python3` is installed — e.g. on Windows, where
the Store stub doesn't count).

## Repo layout

See [Architecture](../README.md#architecture) for the `src/` layout. A
sibling view, indexed by concern:

| Concern | File(s) |
|---|---|
| Tool schemas, LLM-visible behavior | `src/index.ts` (`exec_command`, `write_stdin`, `set_on_exit`, `kill_session`, `list_sessions`) |
| Session lifecycle (spawn, write, kill, log-stream) | `src/session.ts` |
| Session registry, LRU eviction, shutdown | `src/session-store.ts` |
| The yield-until-deadline loop (relative polls) | `src/collect.ts` + `src/notify.ts` |
| Absolute `yield_until` waits (event-driven, monotonic) | `src/long-wait.ts` + `src/time.ts` |
| Human duration / remaining labels | `src/format-time.ts` (re-exported remaining helper from `time.ts`) |
| `on_exit: "wake"` completion scheduling (exactly-once) | `src/completion.ts` (`setOnExit`, tombstones, flush) |
| In-memory drain buffer | `src/head-tail-buffer.ts` |
| On-disk log file mirroring | `src/session.ts` (`logStream`) |
| Tail truncation for the LLM | `truncateTail` imported from `@earendil-works/pi-coding-agent` |
| C-style escape decoding for `chars` | `src/unescape.ts` |
| PTY vs pipe spawning, Windows tree-kill | `src/pty.ts` |
| Shell selection & argv construction | `src/shell.ts` |
| TUI renderCall / renderResult | `src/render.ts` |
| Initiative / doctrine docs | `docs/IV-*.md`, `docs/DC-*.md` |
| Constants mirroring codex | top of `src/index.ts` |

## Dev loop

1. Edit files under `src/`.
2. `npx tsc --noEmit` (catch type errors early).
3. `npx tsx --test tests/<relevant>.test.ts` (fast inner loop).
4. `npx tsx --test tests/*.test.ts` before committing.
5. In a running pi: `/reload` to pick up changes.

### Important gotchas for the dev loop

- **`/reload` does NOT affect tool calls already in flight.** Finish or
  kill the call (`kill_session` tool, or Esc on the pi prompt) before
  reloading, otherwise you'll mix old and new code.
- **If you're driving this extension's own tools from the pi session
  you're editing,** you're working against a snapshot: your edits take
  effect *after* `/reload` (or after full pi restart). Symptom: you
  change `src/unescape.ts`, save, call `write_stdin chars="\x03"` —
  still see the old behavior. Run `/reload` and retry.
- **`pi -p` (print mode) loads extensions fresh per invocation.** No
  `/reload` needed, but each run is a new process.

### Live testing via tmux (no LLM in the loop)

```bash
tmux kill-session -t pi-test 2>/dev/null
tmux new-session -d -s pi-test -x 180 -y 50 "pi --provider anthropic --model claude-sonnet-4"
sleep 4
tmux send-keys -t pi-test "Run exec_command on: echo hello" Enter
sleep 6
tmux capture-pane -t pi-test -p | tail -20
tmux kill-session -t pi-test
```

Useful for verifying the TUI renderer (`renderCall` / `renderResult`)
changes that don't show up in unit tests.

### Live testing via pi -p + jq

```bash
pi -p --mode json --provider anthropic --model claude-sonnet-4 \
  "Use exec_command to run 'seq 1 3'" | jq -r 'select(.type=="message_end").message.content[]?.text?'
```

## Running specific test files

```bash
# Pure units (fast, no subprocesses)
npx tsx --test tests/head-tail-buffer.test.ts \
                tests/notify.test.ts \
                tests/truncate.test.ts \
                tests/unescape.test.ts \
                tests/session-store.test.ts

# End-to-end against real bash / cat (seconds)
npx tsx --test tests/e2e.test.ts
npx tsx --test tests/chars-encoding.test.ts

# PTY-backed (requires @homebridge/node-pty-prebuilt-multiarch to have loaded)
npx tsx --test tests/e2e-pty.test.ts

# The yield-deadline loop
npx tsx --test tests/collect.test.ts
```

## Writing new tests

We use Node's built-in `node:test` runner loaded via `tsx` (no jest,
no vitest). Pattern:

```ts
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { myFunction } from "../src/my-module.ts";

describe("my-module", () => {
  it("does the thing", () => {
    assert.equal(myFunction("in"), "out");
  });
});
```

For end-to-end tests that need the full tool pipeline, use the
`makeHarness()` pattern from `tests/e2e.test.ts` — it instantiates the
extension with a stub `ExtensionAPI` and exposes `call(toolName, args)`
and `emit(event)` so you can drive tools directly without a running
LLM.

## Common tasks

### Add a new escape sequence to `unescape.ts`

1. If it's a one-character escape (`\X` → single char): add an entry
   to the `SIMPLE_ESCAPES` map in `src/unescape.ts`.
2. Add a test case under `"decodes simple one-char escapes"` in
   `tests/unescape.test.ts`.
3. Update the escape table in `README.md` under
   "Control bytes and escapes in `chars`".

Multi-char escapes (like `\xHH`, `\u{…}`) live in the main decode
loop; see the existing `\x` and `\u` branches for the pattern.

### Change a codex-facing constant

All constants live at the top of `src/index.ts` with a comment block
stating whether they mirror codex or diverge. When you touch one:

1. Update the value.
2. Update the `## Constants` section in `README.md`.
3. Check whether any e2e test depends on the old value (search for
   the number literal).

### Add a new field to the response shape

1. Add it to `interface ResponseShape` in `src/index.ts`.
2. Add the conditional line in `renderResponseText(shape)` for LLM
   visibility.
3. Plumb it through `FinalizeInput` and every `finalizeResponse({ … })`
   call site.
4. If the TUI should show it, update `buildStatusLine()` in
   `src/render.ts`.
5. Add a test asserting `r.details.<field>` in `tests/e2e.test.ts`.

### Tune TUI rendering

`src/render.ts` is the only file that touches pi-tui (`Text`,
`Container`, `theme.fg`, etc.). Changes here are visual-only and
won't affect tests. Verify via the tmux recipe above.

## Debugging aids

- **Per-session log files** at `/tmp/pi-unified-exec-<sid>-*.log`
  capture the complete raw byte stream the child wrote. Tail them to
  diagnose ANSI / control-sequence issues.
- **`details.output` vs `content[0].text`**: the LLM reads
  `content[0].text` (structured); the TUI renderer reads
  `details.output` (clean body). If the TUI shows a header like
  `[still running]\nsession_id: …` verbatim, the renderer is failing
  and falling back to pi's default. Check `src/render.ts`.
- **`list_sessions` tool** (invokable from the LLM side) is the
  quickest way to audit what's live.
- **Pi's `/reload` output** echoes the extensions it loaded — check
  that `unified-exec` (or `src/index.ts` under it) is listed.

## Checking upstream compatibility

Every time `@earendil-works/pi-coding-agent` (the host "pi" CLI) cuts a
release, our extension might break silently. The 6-step recipe below
turns a version bump into a 5-minute audit instead of a "why did my
tools stop rendering" debugging session. Record the result in
[`Changelog.md`](../Changelog.md) so the next person doesn't redo the
work.

### 1. Read the upstream changelog

Source of truth:
[`packages/coding-agent/CHANGELOG.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md).
(The repo moved from `badlogic/pi-mono` to `earendil-works/pi`; old URLs
redirect but prefer the new ones. Package scope moved from
`@mariozechner/*` to `@earendil-works/*` in 0.74.0 — the old npm scope is
frozen at 0.73.1.)

Fetch it and stop at the version we're pinned to so you only see
entries that are newer than ours:

```bash
CURRENT=$(npm pkg get devDependencies.'@earendil-works/pi-coding-agent' | tr -d '"')
echo "pinned to $CURRENT"

curl -sL https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/CHANGELOG.md \
  | awk -v v="$CURRENT" '/^## \[/ { if (index($0, "[" v "]")) exit } { print }'
```

For each release entry, focus on three kinds of items:

- **Breaking Changes** — must be read in full; assume they affect us
  until step 2 proves otherwise.
- **Removed** / **Changed** entries mentioning named exports, event
  shapes, or `ExtensionAPI` / `ExtensionContext` methods.
- **Added** entries touching the same surface — safe to skip at first,
  but worth knowing when we later want to adopt them (new hook
  arguments, new `ctx.ui` primitives, etc.).

Ignore everything about the TUI chrome, OAuth providers, RPC protocol,
`models.json`, custom themes, `/slash` commands, skills, subagents,
compaction, hooks, and HTML export — we don't use any of them.

### 2. Cross-check against our import surface

Confirm what we actually consume:

```bash
grep -rh 'from "@earendil-works/pi-coding-agent' src/ | sort -u
```

As of 2026-04-21 the surface is:

- **Types**: `ExtensionAPI`, `ExtensionContext`, `AgentToolResult`,
  `ToolRenderResultOptions`, `Theme`, `TruncationResult`
- **Helpers**: `formatSize`, `truncateTail`, `truncateToVisualLines`
- **Constants**: `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`
- **`ExtensionAPI` methods**: `on("session_start" | "session_shutdown")`,
  `registerFlag`, `getFlag`, `registerTool`, `getActiveTools`,
  `setActiveTools`
- **`ExtensionContext` fields** (via the `ctx` / `eventCtx` argument):
  `ui.notify`, `cwd`, `hasUI`

If an upstream changelog entry mentions **none** of the symbols above,
it cannot affect us. If it mentions one, read it carefully and run
step 3 to confirm.

### 3. Probe the installed `.d.ts`

The surest test is to bump locally and let TypeScript tell us:

```bash
npm install --save-dev @earendil-works/pi-coding-agent@<new-version> \
                         @earendil-works/pi-tui@<new-version>
npx tsc --noEmit
```

A clean typecheck means the API surface we import is unchanged. If it
errors, grep the installed declarations to find the new shape:

```bash
grep -rn 'getActiveTools\|setActiveTools\|SessionShutdownEvent' \
  node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
```

### 4. Run the full test suite

```bash
npx tsx --test tests/*.test.ts
```

`tests/e2e.test.ts` stubs `ExtensionAPI` ourselves, so a clean
typecheck plus passing tests is strong evidence of compatibility. For
TUI-rendering changes (rare), additionally sanity-check via the tmux
recipe in [Dev loop → Live testing via tmux](#live-testing-via-tmux-no-llm-in-the-loop).

### 5. Record the result in `Changelog.md`

Add an entry under today's date even when nothing had to change:

```markdown
## YYYY-MM-DD

### Verified

- **Upstream compatibility with `@earendil-works/pi-coding-agent` X.Y.Z**:
  <one sentence summary of what changed upstream and why it doesn't
  affect us, or what we had to change if it did>.
```

This is the audit trail — without it the next upgrade starts from
zero.

### 6. Bump the pin

If steps 1–4 pass, bump both dev pins in `package.json` and commit:

```bash
npm install --save-dev @earendil-works/pi-coding-agent@<new-version> \
                         @earendil-works/pi-tui@<new-version>
npx tsc --noEmit && npx tsx --test tests/*.test.ts
git add package.json package-lock.json Changelog.md
git commit -m "unified-exec: verify compat with pi-coding-agent <new-version>"
```

`peerDependencies` stays at `"*"` — end users pick up whatever pi
version they already have installed; the dev pins only govern what we
typecheck and test against.

## Releasing to npm

Every `v*` tag push publishes to
[npm](https://www.npmjs.com/package/pi-unified-exec) via
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml).
Fully automatic — no clicks, no secrets, no OTP prompts.

### Authentication model

The workflow uses **npm Trusted Publisher (OIDC)**. The job declares
`id-token: write`, GitHub Actions mints a short-lived token tied to
the run's identity, and npm validates it against the Trusted Publisher
config at
[npmjs.com/package/pi-unified-exec/access](https://www.npmjs.com/package/pi-unified-exec/access).
No `NPM_TOKEN` secret exists in this repo and none should be created.

Publishes include a [sigstore provenance
attestation](https://docs.npmjs.com/generating-provenance-statements)
(`--provenance` in the workflow) that gives each version a verified
badge on npm linking back to the exact commit and CI run that produced
the tarball.

### Release flow

```bash
npm version patch                  # 0.1.0 → 0.1.1, commits + creates v0.1.1 tag
git push && git push --tags
```

That's the whole thing. The tag push triggers the workflow; ~2 minutes
later the new version is live on npm. Use `patch` / `minor` / `major`
as appropriate for semver.

### What CI does on tag push

1. `npm ci` — reproducible install from `package-lock.json`
2. `npx tsc --noEmit` — typecheck
3. `npx tsx --test tests/*.test.ts` — full test suite (246 tests)
4. **Version-vs-tag guard**: fails CI if `package.json` version doesn't
   match the git tag. Catches the "forgot to bump" footgun.
   `npm version` does both atomically so this normally passes.
5. `npm publish --provenance` — publishes the tarball.

Tarball contents are controlled by `files` in `package.json`:
`src/`, `README.md`, `LICENSE`. Tests, `local_data/`, `tsconfig.json`,
`.github/`, `AGENTS.md` are all excluded. Verify with
`npm pack --dry-run`.

### Troubleshooting

- **Tag pushed but workflow didn't fire**: confirm the tag starts with
  `v` (trigger is `tags: ["v*"]`). `v0.1.1` ✓, `0.1.1` ✗,
  `release-0.1.1` ✗.
- **Publish failed, tag is now "wasted"**: fix-forward with another
  `npm version patch && git push --tags` is usually simplest. To
  recycle the same version: `git tag -d v0.1.1 && git push origin
  :refs/tags/v0.1.1`, fix, retag, push.
- **OIDC auth error** (e.g. `Unable to authenticate, your
  authentication token seems to be invalid`): verify the Trusted
  Publisher config on npmjs.com matches exactly:
  - Provider: GitHub Actions
  - Organization/user: `iamwrm`
  - Repository: `pi-unified-exec`
  - Workflow filename: `publish.yml`
- **Provenance badge missing on new version**: confirm
  `permissions: id-token: write` is still present in
  `.github/workflows/publish.yml`.

### Escape hatches

- **`workflow_dispatch`**: the workflow also accepts manual triggers
  from [Actions → Publish to
  npm](https://github.com/iamwrm/pi-unified-exec/actions/workflows/publish.yml)
  → **Run workflow**. Useful for re-runs after a transient npm outage.
  Note: the publish step still tries to ship whatever version is in
  `package.json`, so only use this if that version isn't already on
  npm.
- **Local publish** (fallback, requires 2FA OTP from your npm account):
  ```bash
  npm login
  npm publish --no-provenance
  ```
  `--no-provenance` is needed because provenance only works inside a
  recognized CI provider. Only use this if CI is broken; every CI
  publish is better.

## Commit conventions

Match the existing history:

```
unified-exec: <terse present-tense summary>

<paragraph(s) of what and why, wrapped to ~72 cols>

- bullet of file/change
- bullet of file/change

<N>/<N> tests pass; clean typecheck.
```

Keep each commit focused (one feature / fix). `git log --oneline` for
prior commits gives a sense of scope.

## Sources to read before changing core behavior

- Codex's `unified_exec` implementation is the reference for session
  semantics:
  [`codex-rs/core/src/unified_exec/`](https://github.com/openai/codex/tree/main/codex-rs/core/src/unified_exec)
- Pi's built-in `bash` tool is the reference for output retention:
  `@earendil-works/pi-coding-agent/dist/core/tools/bash.js` (locally
  installed in `node_modules/`).
- Pi's extension API docs:
  `@earendil-works/pi-coding-agent/docs/extensions.md`.

Both source trees are worth keeping open in split panes while you work.
