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
- Every other key does nothing, so Enter and a stray letter cannot approve a call.
- An allow key is ignored until 350 milliseconds pass with no other key, so a message that the user
  is still typing cannot approve anything.
- Only one dialog exists at a time. A script that starts several calls at once waits its turn, so a
  key meant for one dialog cannot answer another.

Outside the terminal interface, Pi shows a selector with `Deny` first and `Allow once` second, and
the selector follows an abort. A dialog that nobody answers keeps waiting, which is the same as the
dialog staying on screen.

## What the dialog shows

Every field the model sent appears, primary value first and the rest as `field=value`. That includes
the shell, the working directory, the file content, and the text written to a session.

- Base64 input appears as the text it stands for.
- Session input is decoded the way Unified Exec decodes it, so `\x15` and `\r` appear as the control
  characters that reach the session.
- Control characters, format characters, every Unicode space except the plain space, and every code
  point that a renderer may ignore appear as escapes such as `\x1b`, `\u00a0`, and `\u{202e}`.
- A backslash appears as `\\`, so escaped text cannot pass for typed text.
- A long value is cut and marked with the number of characters that the approval still covers.

## What passes without a dialog

Local reads: `read`, `grep`, `find`, `ls`, `todo`, `update_plan`, `list_sessions`, and a
`write_stdin` poll with no input.

A tool declaration wins over that list. A call passes on its declarations only when it declares
`readOnlyHint: true`, `openWorldHint: false`, and no `destructiveHint`. So a tool that reaches the
network asks, including `web_search` and `fetch_content`, because a read followed by a fetch can
send a local file out.

A call that a script makes inside another tool does not inherit the approval of the outer call. The
script's call asks with its own words.

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
interface except the dialog and the answer to `/gate`.

## Runs without a dialog

Print and JSON runs cannot approve a call, and RPC runs can only answer when the client answers
extension UI requests. Without an answer, the gate blocks the call and gives the model a reason that
names the environment variable, so the run fails loudly instead of running the call.

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
