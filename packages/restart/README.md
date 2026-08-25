# Pi restart

Restart Pi as a new process and reopen the exact same persisted session.

Pi's `/reload` command reloads extensions and other resources inside the current process. This
package adds `/restart` for cases where Pi itself must start again.

## Start Pi

Start Pi as usual:

```sh
pi
```

The installed `pi` command is the restart-aware launcher. OnurPi puts it at `~/.local/bin/pi`, ahead
of the upstream Pi command in `PATH`. Start one new shell after the first installation so the shell
forgets any older cached command path.

The launcher skips itself, runs the next `pi` executable as its child, and keeps control of the
terminal while Pi restarts. It does not modify the upstream Pi installation or shell startup files.

The user-level link survives an upstream Pi reinstall and automatically finds the updated runtime.
OnurPi creates or repairs this link during installation. It refuses to replace an unrelated file at
that path.

When upgrading from the short-lived bridge design, installation restores only its old managed
upstream link and removes only its exact old Zsh block. It leaves unrelated commands and shell
content unchanged.

## Restart

Inside Pi, run:

```text
/restart
```

The extension sends the exact session file, session ID, and working directory to the launcher. The
launcher validates them. Pi then shuts down cleanly, and the launcher starts a new Pi process with
the exact session file.

A successful restart keeps:

- the session file and session ID;
- the working directory;
- the terminal and Herdr pane.

The Pi worker PID changes because the launcher starts a new worker.

## Supported startup arguments

Automatic restart supports a conservative set of documented configuration and resource flags. It
rejects startup prompts, ephemeral sessions, forks, resume pickers, print mode, RPC mode, API keys,
unknown flags, combined `--flag=value` forms, and ambiguous arguments.

Unsupported arguments do not stop the first Pi process from starting. They only make automatic
restart unavailable. `/restart` then keeps Pi running and explains the reason.

Initial support is limited to persisted interactive sessions on tested Linux terminals. macOS and
Windows fail closed until equivalent real-terminal tests exist.

## Failure behavior

Failures before launcher acceptance leave Pi running. The extension does not request shutdown.

The launcher starts no replacement until the old Pi worker exits. If replacement startup fails, it
leaves the session file unchanged and prints the exact manual recovery command. It never selects the
latest session and never enters an automatic restart loop.

## State and security

The private `onurpi-restart-v1` IPC protocol carries only:

- request ID;
- process generation;
- session file;
- session ID;
- working directory.

It carries no credentials, prompts, provider data, or session content. The only persistent install
change is the `~/.local/bin/pi` symlink. The package creates no state file, service, daemon, or
socket and does not write to the session file.

## Development

Run package checks:

```sh
npm run check
npm run slophammer
```

Then run the repository checks and the real Pi restart smoke test described in the canonical
[Pi restart plan](../../docs/2026-08-24-pi-restart-plan.md).
