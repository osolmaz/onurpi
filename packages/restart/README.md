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
of the upstream Pi command in `PATH`. It safely redirects the active Node installation's managed
`pi` link to this launcher. This makes an already-running shell's cached path use the launcher
without a `rehash` command. It also installs a small managed Zsh function that calls the stable path
directly in future shells.

The launcher skips itself and runs the next `pi` executable as its child. When PATH entries resolve
back to the launcher, it uses the co-installed Pi package entry point. It keeps control of the
terminal while Pi restarts.

The user-level link and Zsh function survive an upstream Pi reinstall and automatically find the
updated runtime. OnurPi creates or repairs them during installation. The active Node command bridge
can be replaced by an upstream reinstall, but the stable Zsh function remains authoritative. OnurPi
refuses to replace an unrelated command link, an unrelated file at the stable command path, or a
malformed managed Zsh block.

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

It carries no credentials, prompts, provider data, or session content. The persistent install
changes are the `~/.local/bin/pi` symlink, the active Node installation's managed `pi` link, and one
marked function block in `~/.zshrc`. The package creates no state file, service, daemon, or socket
and does not write to the session file.

## Development

Run package checks:

```sh
npm run check
npm run slophammer
```

Then run the repository checks and the real Pi restart smoke test described in the canonical
[Pi restart plan](../../docs/2026-08-24-pi-restart-plan.md).
