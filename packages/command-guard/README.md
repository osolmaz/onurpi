# Command Guard

Command Guard blocks dangerous filesystem commands before Pi starts them.

It is a Pi extension. It does not change Pi core.

## What it guards

Command Guard checks these command routes:

- Pi's built-in `bash` and `powershell` tools;
- direct `!` and `!!` Bash commands;
- OnurPi Unified Exec `exec_command` starts;
- nonempty Unified Exec `write_stdin` input.

It disables active custom tools with top-level `cmd`, `command`, or `script` parameters when they do
not have a reviewed final execution adapter. Unknown shells are also blocked because their quoting
and expansion rules cannot be checked safely.

It recognizes direct and nested forms of `rm`, `unlink`, `rmdir`, `shred`, `find -delete`,
destructive `find -exec`, `xargs`, `rsync --delete`, destructive Git worktree commands, `truncate`,
`dd` output, and truncating shell redirection. It also checks direct PowerShell and `cmd.exe`
deletion forms.

The Bash path uses the official Tree-sitter Bash grammar. It reads the exact command, final working
directory, selected shell, and child environment. A fixed variable such as `$TARGET` is allowed only
when its value is known and the script does not change it. Command Guard does not add a Yes/No gate.

This incident is blocked:

```bash
HOME=$(mktemp -d) command; rm -rf "$HOME"
```

`HOME` changes in the same script, so Command Guard does not guess which path Bash will use.

## Decisions

Command Guard makes one of three decisions:

- **Allow:** The command is safe, or every destructive target is exact and outside the protected
  paths.
- **Rewrite:** Shell expansion or command behavior makes the target uncertain. Submit a literal
  path.
- **Deny:** The target is a protected path or the final check failed.

The extension denies filesystem roots, the home directory, the Pi working directory, mount roots,
and their ancestors. It resolves symlinks, records filesystem object identities, and checks them
again immediately before execution.

Each allowed tool call gets a one-use final check that expires after 60 seconds. It binds the exact
command, shell, working directory, referenced environment values, target paths, and object
identities. A changed request is blocked.

There is no confirmation prompt, model-callable bypass, project setting, environment switch, or
"allow always" choice. Exact deletions outside protected paths run normally. Use a separate terminal
when you deliberately need to delete a protected root.

## Unified Exec input

Empty polls and input made only of Ctrl-C or Ctrl-D bytes are allowed. Other `write_stdin` input is
blocked. Command Guard cannot safely reconstruct commands from terminal editing, REPL state, or
split writes.

A future input protocol can pass only after it gets a specific final adapter and tests.

## Status

Run:

```text
/command-guard
```

The command shows active guarded tools, unsupported command tools that were disabled, and pending
one-use checks. It does not show environment values or command contents.

## Limits

Command Guard cannot intercept:

- commands that another extension starts with `pi.exec`, Node child-process APIs, native code, or an
  unregistered execution path;
- a later extension that deliberately replaces a guarded tool after Command Guard loads;
- commands run in another terminal or by an already-running process;
- deletion hidden inside an arbitrary program that has no covered command form;
- command text stored under an unknown custom-tool field;
- operating-system actions that do not pass through a guarded Pi command route.

Covered command names assume the executable has its normal documented behavior. A different binary
with the same name is an arbitrary program and is outside this command-level boundary. There is also
a small path race between the last identity check and the operating system opening the target. A
portable extension cannot make that pair of actions atomic.

Unified Exec uses its public `registerFinalCommandPolicy()` API. It rebuilds a frozen snapshot from
the actual spawn arguments or input bytes after all shared-event listeners, then runs Command Guard
immediately before spawn or input. A custom command tool needs an equivalent documented final
pre-execution check. A `tool_call` hook alone is not enough because a later extension can change its
input.

## Development

```bash
npm run check --workspace=@onurpi/command-guard
npm run slophammer --workspace=@onurpi/command-guard
```

The package is private. Its parser dependencies and reviewed artifacts are recorded in
[UPSTREAM.md](UPSTREAM.md).
