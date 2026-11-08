---
name: herdr
description: "Control Herdr: herdr-core (`hc`) runs terminals and coding agents that stay alive, and `herdr-app` drives the person's window (spaces, tabs, panes, mods). Use when the user mentions Herdr or asks to inspect or control terminals, agents, spaces, tabs, or the window, and when a Herdr session needs a topic label. Requires HC_TERMINAL_ID."
---

# Herdr

Herdr has two tools:

- `hc` (herdr-core) runs programs and agents in terminals that stay alive.
  It does not arrange windows.
- `herdr-app` controls the person's window: spaces, tabs, panes, focus, mods.

The older `herdr` multiplexer CLI is not this system. Do not use it. If the
user asks about windows and layout, that is `herdr-app`.

## Check that you are inside

```bash
test -n "${HC_TERMINAL_ID:-}"
```

If the check fails, say that you are not running inside Herdr Core and stop.

`$HC_TERMINAL_ID` is your own address, such as `t2`. It is a terminal, not a
pane. Terminals you start are your children and end when you end, unless
started with `--outlive-parent`. Give children a name of 1 to 32 characters
from `a-z 0-9 - _`.

## Read the installed manuals first

The installed binaries are the authority for syntax and behavior:

```bash
hc --skill
herdr-app --skill
```

Read both before control work. Then use `hc <command> --help` and
`herdr-app commands` for exact arguments.

Do not launch bare `hc` or bare `herdr-app` for discovery. The first picks a
terminal and attaches to it, and the second opens or raises the window. Do not
probe a mutating command by leaving its arguments out.

## Inspect before acting

```bash
hc ls                 # live terminals, including the person's other work
hc get <t>            # one terminal: state, status, labels, foreground program
hc templates          # ready-made agent roles, if any
herdr-app ls          # spaces > tabs > terminals, with pane IDs
herdr-app status      # layout, focus, overlays, zoom, errors
```

Read addresses and IDs from these replies. Do not guess or derive them.
`herdr-app ls` gives long opaque IDs. `hc` uses short terminal addresses such
as `t7`, a name, or `machine/t7`.

## Delegate work to agents

Default to a background terminal in the current folder, invisible in the
window:

```bash
hc run --bg --name review --cwd /path/to/repo claude \
  "Review only src/x.rs. Do not start agents. Report findings with hc send $HC_TERMINAL_ID when done or stuck."
```

- Put the first task in `run`. A `send` to a booting agent can be dropped.
- Without a fitting template, start the agent first and wait for readiness, then
  send: `hc run --bg --name fix pi` then `hc wait fix`, then
  `hc send fix "<task>"`.
- Run agents interactively. Never use a one-shot print mode such as `pi -p`.
  Agents stay watchable, steerable, and ready for another turn.
- Codex needs `--no-daemon`, or its commands run outside `hc`.
- Do not let children start more agents unless you assign that.
- Ask every child to report with `hc send $HC_TERMINAL_ID`, and to write long
  answers to a file and send its path.
- Do not hand off work the user did not ask you to delegate.

Read `result.first_message.sent` after a launch with a task. If it is false,
the task was not sent: run `hc read <t>`, resolve readiness, for example a
trust dialog with `hc keys <t> down enter`, then send. Never resend blindly,
because the task may still have arrived.

## Wait, do not sleep

```bash
hc wait review                      # until it stops working, or exits
hc wait web --output ready          # until it prints that text after the wait starts
hc wait --children any              # the next child report
hc wait --children all              # until no child is working
```

Never sleep or poll. A wait timeout is a check-in, not a failure: wait again.
A `reason: message` wait ends early because a report arrived as your next input.

Statuses come from agent reports: `idle`, `working`, `done`, `blocked`,
`error`. Plain programs report none.

- `blocked` needs a person. Read the screen, then ask the user.
- `error` needs the reason read before you send again or kill the terminal.
- Read the real output before you summarize a child's result.

## Screens, messages, cleanup

```bash
hc read --lines 100 review
hc send review "Focus on the first bug"
hc send --wait review "Recheck the fix"
hc interrupt review          # stop its turn, not the process
hc kill review; hc rm review
```

Use `--rm` on short helpers. Clean up terminals you started once you have their
results. `hc ls` includes the person's other live work: never kill or remove a
terminal you did not start.

## Keep your own shell free

Your command tool holds you until the command ends, so no reports arrive.
Run slow work in a terminal and wait on it:

```bash
hc run --bg --rm --no-notify --name build cargo build --release
hc wait build
```

## Show work in the window only when asked

Use `hc` for orchestration that needs no new view. When the user asks to see a
terminal, tab, or split, use `herdr-app`, with an explicit name:

```bash
herdr-app do tab.new --name "fix login" --argv '["claude"]' --task "Look at the login bug"
herdr-app do pane.split --direction right --pane "$PANE"
herdr-app do space.new --name "api" --folder /path/to/api
```

Read the created IDs from the reply, then confirm with `herdr-app ls` and
`herdr-app status`. A success reply means the terminal exists, not that its
program started correctly.

A terminal opts into the window with the `herdr.space` label, and
`herdr.tab` chooses its tab. Unlabeled workers stay hidden. Do not add labels
just to run a background worker.

## Label the calling space and tab

When your own space or tab has no meaningful label, set one once the topic is
clear. Do not wait for the user to ask.

Find your space and tab from your own terminal record:

```bash
hc get "$HC_TERMINAL_ID"     # read labels: herdr.space, herdr.tab
herdr-app ls                 # confirm those IDs and their current names
```

- Treat a missing, empty, or numeric label as untitled.
- Do not overwrite a meaningful label the user set.
- Use at most 25 characters and at most 5 words.
- Base the label on the conversation topic, not implementation details.

```bash
herdr-app do space.rename --id "$SPACE" --name "Short Topic"
herdr-app do tab.rename --id "$TAB" --name "Short Topic"
herdr-app ls
```

## GitHub PR sidecar layout

When the user asks to use Herdr to open a GitHub PR, build a two-pane space:

- Left: `gzg 'owner/repo#123'`.
- Right: Codex, in the repository or a PR-specific worktree.

Prefer a dedicated worktree for review, edits, tests, CI repair, or follow-up
work. Reuse a matching worktree, or create one with the repository's normal
conventions. Quote resources that contain `#`.

```bash
WORKTREE=/path/to/repo-worktrees/pr-123
herdr-app do space.new --name "repo PR #123" --folder "$WORKTREE"
# read the created space, tab, pane and terminal from the reply
herdr-app do pane.split --direction right --pane "$PANE" --argv '["codex"]'
hc send "$LEFT_TERMINAL" "gzg 'owner/repo#123'"
```

Then verify both sides: `herdr-app ls` for the layout, the left screen shows
the PR, and the right terminal holds an idle Codex session in the intended
checkout.

## Safety

- Never stop or restart the core, or quit the window, unless the user asks. It
  ends or disturbs every terminal, including other agents' work.
- Updates are `hc update`, `herdr-app do app.update`, and
  `herdr-app do app.update_core`. Run them only when the user asks to update
  Herdr. An install or repair request is not an update request.
- Herdr can refuse an update from inside a managed terminal. Never unset or
  override `HC_*` variables to bypass that guard. Report it and let the user
  run the update outside Herdr.
- Test the API or a mod in an isolated session: its own `HC_SESSION` and
  scratch XDG paths, not the live one.
- Mods are trusted JavaScript. Make only the requested change, then run
  `herdr-app check <mod>`, `herdr-app status`, and `herdr-app shot`.
- Never experiment with pointer or key automation on the person's display.
