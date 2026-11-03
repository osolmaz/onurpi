# Permission Gate

Ask before a tool call that can change something, and switch the gate on or off inside a session.

## What it does

The gate is on when Pi starts. Before a tool call that is not a local read, Pi shows a dialog:

- `Deny` blocks the call and tells the model that it did not run. It is the first option, so an
  accidental Enter or a typed letter denies instead of allows.
- `Allow once` runs this call only. The next call asks again, even for the same tool.

Local reads pass without a dialog: `read`, `grep`, `find`, `ls`, `todo`, `update_plan`,
`list_sessions`, a `write_stdin` poll with no input, and any tool that declares
`readOnlyHint: true`.

A tool that declares `readOnlyHint: false` or `destructiveHint: true` asks, even when its name is on
the local read list.

Calls that reach the network ask too, such as `web_search` and `fetch_content`. A read followed by a
fetch can send a local file out, so the gate treats them as changes.

A call that a script makes inside another tool does not inherit the approval of the outer call. The
script call asks with its own words, so an approval covers the command that the user saw.

The dialog shows the command, the script, the file path, or the text written to a session. Control
characters, and the bidirectional and zero-width characters that can hide text, appear as escapes
such as `\x1b` and `\u202e`. A long value is cut and marked `[truncated]`.

## Turn it off and on

```
/gate          toggle and report the new state
/gate off      stop asking
/gate on       start asking again
/gate status   report the state
```

The state lives in process memory. A new session, a fork, a resume, a reload, or a new Pi process
starts with the gate on.

The gate writes no status line, widget, footer, header, or session entry, so it adds nothing to the
interface except the dialog and the answer to `/gate`. The dialog is a selector, so a tool that
watches the Pi status sees a question.

## Runs without a dialog

Print and JSON runs cannot approve a call. RPC mode can, when its client answers extension UI
requests. The gate blocks a call that needs approval and gives the model a reason that names the
environment variable.

Start a run that must not ask with the gate off:

```bash
PI_PERMISSION_GATE=off pi -p "your prompt"
```

`PI_PERMISSION_GATE` accepts `off`, `false`, `0`, and `no`. Any other value, or no value at all,
leaves the gate on.

## Limits

The gate is a supervision aid, not a security boundary. It cannot check that an approved command is
safe, and code inside an approved call runs with the permissions of the Pi process. Use
`@onurpi/command-guard` for commands that must never run, and an isolated environment for work that
must not reach your files.

The approval dialog covers the exact input that it shows. If a tool later changes its arguments, or
a handler loaded after this extension rewrites them, the user approved an earlier version. Command
Guard loads after this extension and blocks destructive commands on its own.
