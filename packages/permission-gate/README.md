# Permission Gate

Ask before a tool call that is not read-only, and switch the gate on or off inside a session.

## What it does

The gate is on when Pi starts. Before each tool call that can change files, run commands, or reach
outside the session, Pi shows a dialog:

- `Allow once` runs the call.
- `Always allow <tool> in this session` runs the call and stops asking for that tool.
- `Deny` blocks the call and tells the model it was not approved.

Read-only tools pass without a dialog. These are `read`, `grep`, `find`, `ls`, `todo`,
`update_plan`, `list_sessions`, `web_search`, `source_check`, `fetch_content`, `get_search_content`,
a `write_stdin` poll with no input, and any tool that declares `readOnlyHint`.

A tool call that a script makes inside another approved call, such as a tool reached from
`codemode`, does not ask again.

## Turn it off and on

```
/gate          toggle and report the new state
/gate off      stop asking
/gate on       start asking again
/gate status   report the state and the tools allowed for this session
```

The state lives in process memory. A new session starts with the gate on. Allowing a tool for the
session also ends with the session.

The gate writes no status line, widget, footer, or header, so it adds nothing to the interface
except the dialog and the answer to `/gate`.

## Runs without a dialog

Print, JSON, and other non-interactive runs cannot approve a call. The gate blocks a call that needs
approval and gives the model a reason that names the environment variable. Start such a run with the
gate off:

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
