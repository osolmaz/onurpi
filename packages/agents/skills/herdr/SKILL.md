---
name: herdr
description: "Control Herdr, a terminal multiplexer for coding agents. Use when the user explicitly mentions Herdr or asks to inspect or control panes, tabs, workspaces, terminals, commands, agents, waits, or GitHub PR sidecar layouts, and when a Herdr-managed session requires automatic topic labeling of the calling workspace or tab. Do not use merely because a task could benefit from a background terminal, delegation, or parallel work. Requires HERDR_ENV=1."
---

# Herdr

Herdr is a terminal multiplexer and runtime for coding agents. It organizes
terminals into workspaces, tabs, and panes, detects agent identity and status,
and exposes the running session through the `herdr` CLI.

Before issuing any control command, check that this agent is running inside a
Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
```

If the check fails, say that you are not running inside Herdr and stop. Do not
inspect or control the focused Herdr session from outside Herdr.

When the check passes, the `herdr` binary in `PATH` talks to the running
session. Use it to inspect neighboring work, create isolated terminal contexts,
start agents and commands, read their output, and wait for state changes.

## Learn the current CLI

Treat the installed binary as the authority for command syntax. Begin with:

```bash
herdr --help
```

Then print the relevant command group by running it without a subcommand:

```bash
herdr pane
herdr workspace
herdr worktree
herdr tab
herdr wait
herdr terminal
herdr notification
herdr integration
herdr session
```

Do not run bare `herdr` for discovery; it launches or attaches the TUI. Do not
probe a mutating nested command by omitting arguments; some commands, including
`herdr workspace create`, are valid with defaults and will execute. Use the
command-group output above instead.

Most control commands print JSON. Read identifiers and state from those
responses instead of predicting either one.

## IDs and current context

Public IDs are short stable handles:

- workspace: `w1`
- tab: `w1:t1`
- pane: `w1:p1`
- terminal: `term_...`

The encoded suffix can contain letters and can grow beyond one character. Treat
every ID as an opaque string.

Closed tab and pane IDs are not reused and do not retarget later resources. A
pane moved into another workspace receives a new public pane ID. Re-read create,
split, move, list, or get responses after mutations; never construct an ID from
a workspace or display number.

Herdr injects the caller's context into every managed pane:

```bash
printf '%s\n' "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
```

Prefer `--current` when a pane command should target the calling pane. Omitting
a target can use the UI-focused pane, which may belong to the user or another
client. A `focused` field describes UI focus; it does not identify the pane
containing this agent.

Resolve the caller's live context with:

```bash
herdr pane current --current
```

Read `workspace_id`, `tab_id`, and `pane_id` from `result.pane`. This response is
the authority after a pane move; launch-time environment variables cannot
change inside an already-running process.

Discover related live state with:

```bash
herdr workspace list
herdr tab list --workspace <caller-workspace-id>
herdr pane list --workspace <caller-workspace-id>
```

## Label the calling workspace and tab

When the calling workspace or tab has no meaningful label, set a concise topic
label automatically once the conversation topic is clear. Do not wait for the
user to ask.

First resolve the caller with `herdr pane current --current`, then inspect only
the returned workspace and tab:

```bash
herdr workspace get <caller-workspace-id>
herdr tab get <caller-tab-id>
```

For automatic labeling:

- Treat a missing, empty, or default numeric label as untitled.
- Do not overwrite a meaningful user-provided label.
- Use at most 25 characters and at most 5 words.
- Base the label on the conversation topic, not implementation details.

If the user explicitly asks to rename the calling workspace or tab, replacing a
meaningful label is allowed. Use only the IDs returned by `pane current` and
verify the result:

```bash
herdr workspace rename <caller-workspace-id> "Short Topic"
herdr tab rename <caller-tab-id> "Short Topic"
herdr workspace get <caller-workspace-id>
herdr tab get <caller-tab-id>
```

## Control agents through panes

An agent runs inside a pane. Use the pane ID as the control target for agents,
shells, servers, tests, and logs. This keeps spawning, input, reads, waits, and
cleanup on one stable control surface.

Use workspace and tab commands for organization. Use worktree commands only
when you intentionally want Herdr to create, open, or remove a Git checkout.

Pane records expose `agent`, `agent_status`, and native session metadata when
available. Agent status is `idle`, `working`, `blocked`, `done`, or `unknown`.

`idle` and `done` are the same underlying semantic state with different
attention state:

- `idle`: the agent is waiting and its result is considered seen.
- `done`: the agent finished and its result has not been seen.

An agent that first opens at its prompt reports `idle`, including in a
background pane. After a working or blocked agent completes, it reports `done`
when its tab or workspace is in the background. It reports `idle` when it
completes in the active tab while the foreground client is focused. If the
foreground client is explicitly unfocused, completion can become `done` even in
the active tab.

Focusing a pane, switching to its tab, or regaining outer terminal focus marks
the visible tab as seen, so `done` becomes `idle`. Switching away does not turn
an existing `idle` status into `done`; `done` is created by a later completion
while the pane is unseen. With no foreground client, a new completion in the
globally active tab is treated as seen while completions in background tabs
still become `done`.

## Start agents interactively

Default to a sibling pane in the current tab and current working directory. Do
not create a workspace, tab, worktree, or different cwd unless the user
explicitly requests that topology or location.

When the user names a workspace, treat that name as an explicit target. List
workspaces, resolve the exact workspace by label and relevant repository path,
then list its panes and target one by explicit pane ID. Never use `--current`,
UI focus, or launch-time environment IDs for a named workspace. If more than
one workspace could match, inspect their panes and working directories before
choosing. After every split, move, or create operation, verify that the returned
`workspace_id` equals the requested workspace. If it does not, immediately
close only the newly created pane and retry with the verified explicit pane ID.

Honor a direction requested by the user. Otherwise inspect the caller pane's
current rectangle:

```bash
herdr pane layout --pane "$HERDR_PANE_ID"
```

Split a wide pane to the right and a narrow or tall pane down. Avoid repeated
same-direction splits that would create unusably narrow columns or short rows.
Keep the user's focus in the calling pane:

```bash
herdr pane split --current --direction right --no-focus
```

Replace `right` with `down` when the layout calls for it.

Read `result.pane.pane_id` from the JSON response. Give the pane a useful label,
then start the requested agent by running only its normal executable so its
interactive TUI opens:

```bash
herdr pane rename <returned-pane-id> "reviewer"
herdr pane run <returned-pane-id> "codex"
```

Use the executable that belongs to the requested agent:

- Codex: `codex`
- Claude Code: `claude`
- pi: `pi`
- OpenCode: `opencode`
- OMP: `omp`

Do not pass the task as an argv prompt by default. Do not add non-interactive
flags. Only change the normal interactive launch when the user explicitly asks
for a different launch mode or command.

Inspect the pane after launch. If `agent_status` is not yet `idle`, wait for the
idle transition. Once it is idle, submit the task with `pane run`:

```bash
herdr pane get <returned-pane-id>
herdr wait agent-status <returned-pane-id> --status idle --timeout 30000
herdr pane run <returned-pane-id> "Review the current diff and report only actionable findings."
```

Status waits match the current status immediately or wait for a future matching
transition.

`pane run` sends the text and Enter together. Use it for initial prompts and
follow-ups instead of coordinating `send-text` and `send-keys` separately.

For normal background work, wait for the agent to start working. If the pane
remains in a background tab or workspace, wait for `done` before reading its
transcript:

```bash
herdr wait agent-status <returned-pane-id> --status working --timeout 30000
herdr wait agent-status <returned-pane-id> --status done --timeout 120000
herdr pane read <returned-pane-id> --source recent-unwrapped --lines 120
```

If the user is watching that tab, completion reports `idle` instead, so wait for
`idle`. Always treat either `idle` or `done` as completed when inspecting
`pane get`; the difference is whether the result has been seen.

If a wait times out, inspect `herdr pane get <returned-pane-id>` and `pane read`
before deciding what to do. A `blocked` agent needs input; an `unknown` pane may
not yet contain a detected or integrated agent.

Submit follow-ups the same way:

```bash
herdr pane run <returned-pane-id> "Now check the failing test."
```

## Run an ordinary command in another pane

Split the calling pane using the same geometry rule without moving the user's
focus:

```bash
herdr pane split --current --direction right --no-focus
```

Read the new `pane_id` from the JSON response, then run and inspect the command:

```bash
herdr pane run <returned-pane-id> "just test"
herdr wait output <returned-pane-id> --match "test result" --timeout 120000
herdr pane read <returned-pane-id> --source recent-unwrapped --lines 120
```

Inspect existing output before waiting for future output. A wait timeout exits
with status `1`.

Use the read source that matches the task:

- `visible`: the current rendered viewport
- `recent`: recent scrollback as rendered, including soft wraps
- `recent-unwrapped`: recent scrollback with soft wraps joined; prefer it for
  logs and transcripts
- `detection`: the bottom-buffer snapshot used by agent detection

Use `--format ansi` when colors and terminal styling are evidence. Otherwise
use text.

If the user explicitly asks for another tab, workspace, or worktree, discover
that command group and use returned IDs. Do not infer a larger topology from a
request to start an agent or command.

## GitHub PR sidecar layout

When the user asks to use Herdr to open a GitHub PR, build a two-pane workspace:

- Left pane: `ghzinga`/`gzg` showing the PR.
- Right pane: Codex running from the relevant repository or a PR-specific
  worktree.

Prefer a dedicated worktree when the task may involve review, edits, tests, CI
repair, or follow-up implementation. Reuse a matching worktree when one exists;
otherwise create one using the repository's normal worktree conventions.

Quote GitHub resources containing `#` so the shell does not interpret the
number:

```bash
gzg 'owner/repo#123'
```

Capture the new workspace and root pane from the same creation response. Never
rediscover the root pane through global UI focus:

```bash
WORKTREE=/path/to/repo-worktrees/pr-123
CREATED=$(herdr workspace create --cwd "$WORKTREE" --label "repo PR #123" --focus)
WORKSPACE=$(printf '%s' "$CREATED" | jq -r '.result.workspace.workspace_id')
LEFT=$(printf '%s' "$CREATED" | jq -r '.result.root_pane.pane_id')
RIGHT=$(herdr pane split "$LEFT" --direction right --cwd "$WORKTREE" --no-focus | jq -r '.result.pane.pane_id')
herdr pane rename "$LEFT" "PR #123"
herdr pane rename "$RIGHT" "codex PR #123"
herdr pane run "$LEFT" "gzg 'owner/repo#123'"
herdr pane run "$RIGHT" "codex"
herdr workspace get "$WORKSPACE"
herdr pane get "$LEFT"
herdr pane get "$RIGHT"
```

After launch, inspect both panes to verify that the left pane renders the PR and
the right pane contains an idle Codex session in the intended checkout.

## Safety and coordination rules

- Use `--no-focus` for background work unless the user asked to switch context.
- Use `--current` or an explicit ID. Do not rely on another client's focused
  pane.
- Parse IDs from JSON responses. Do not derive them from sidebar order or
  examples.
- Inspect before waiting. Read current output first, then wait for the next
  state or output you expect.
- Do not close workspaces, tabs, panes, or sessions you did not create unless
  the user explicitly asked.
- Never run `herdr server stop` from an active session unless the user
  explicitly intends to stop the server and its pane processes.
- Never kill the main Herdr process. Use named test sessions for experiments
  that need an isolated server.
