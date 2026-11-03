# Permission Gate

Ask before a tool call that can change something, and switch the gate on or off inside a session.

## What it does

The gate is on when Pi starts. Before a tool call that is not a local read, Pi shows a dialog with
the whole call in it:

> Allow this call?
>
> bash: npm test
>
> y allow once - n or escape deny

- `y` runs this call only. The next call asks again, even for the same tool.
- `n` or escape blocks the call and tells the model that it did not run.
- Every other key does nothing. Enter and a stray letter cannot approve a call, and an allow key is
  ignored for the first 350 milliseconds, so a message typed just before the dialog opened cannot
  approve anything.
- Outside the terminal interface, Pi shows a selector with `Deny` first and `Allow once` second, and
  the dialog follows an abort.

The dialog shows every field the model sent, primary value first and the rest as `field=value`, so
an approval covers what the user saw. That includes the shell, the working directory, and the text
written to a session. Base64 input appears as the text it stands for.

Control characters, format characters, and every code point that Unicode says a renderer may ignore
appear as escapes such as `\x1b` and `\u{202e}`. A backslash appears as `\\`, so escaped text cannot
pass for typed text.

Local reads pass without a dialog: `read`, `grep`, `find`, `ls`, `todo`, `update_plan`,
`list_sessions`, and a `write_stdin` poll with no input.

A tool declaration wins over that list. A call passes on its declarations only when it declares
`readOnlyHint: true`, `openWorldHint: false`, and no `destructiveHint`. So a tool that reaches the
network asks, including `web_search` and `fetch_content`, because a read followed by a fetch can
send a local file out.

A call that a script makes inside another tool does not inherit the approval of the outer call. The
script's call asks with its own words.

A long value is cut and marked with the number of characters that the approval still covers, so a
hidden tail cannot look harmless.

## Turn it off and on

```
/gate          toggle and report the new state
/gate off      stop asking
/gate on       start asking again
/gate status   report the state
```

The gate keeps only the on or off switch, in process memory. A new session, a fork, a resume, a
reload, or a new Pi process starts with the gate on.

The gate writes no status line, widget, footer, header, or session entry, so it adds nothing to the
interface except the dialog and the answer to `/gate`. The selector that non-terminal modes use
reports the program status `question`.

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

The gate is a supervision aid, not a security boundary. It cannot judge whether an approved command
is safe, and code inside an approved call runs with the permissions of the Pi process. Use
`@onurpi/command-guard` for commands that must never run, and an isolated environment for work that
must not reach your files.
