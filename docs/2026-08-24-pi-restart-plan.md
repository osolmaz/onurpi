---
title: Add the Pi restart command
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-24
tags: [pi, restart, sessions, extensions]
---

# Add the Pi restart command

## Purpose

OnurPi needs a `/restart` command that starts a new Pi process and opens the exact same persisted
session in the same working directory. This is a full process restart. It is different from
`/reload`, which reloads resources inside the current Pi process.

The restart must keep the session safe. It must not select the latest session, create a fork, clone
the session, rewrite the session file, or run two Pi workers against the same session.

## Selected design

Create a private `@onurpi/restart` package under `packages/restart`. The package owns three parts:

- a restart-aware `pi` launcher that stays alive and runs the upstream Pi runtime as its child;
- a Pi extension that registers `/restart`;
- a private in-memory IPC connection between the launcher and the extension.

Users continue to start Pi with `pi`. OnurPi installs its launcher at `~/.local/bin/pi`, which is
before the upstream Pi command in `PATH`. The launcher skips itself, finds the next `pi` executable,
and runs that upstream runtime as its child. This keeps one process in control of the terminal
before, during, and after a restart. It avoids a race in which a shell or Herdr takes the terminal
after the old Pi process exits.

The stable user-level command survives an upstream Pi reinstall. OnurPi's install step creates or
repairs the link without changing the upstream Pi command or shell configuration. If an unmanaged
command already exists at that path, installation must stop instead of replacing it. The user must
start one new shell after the first installation so an existing shell command cache cannot select
the old path.

## Restart flow

When the user runs `/restart`:

1. The extension reads the exact session file, session ID, and working directory from documented Pi
   APIs.
2. The extension sends these values to the launcher through the private IPC connection.
3. The launcher validates the request and accepts or rejects it.
4. The extension calls `ctx.shutdown()` only after the launcher accepts the request.
5. Pi shuts down through its normal lifecycle.
6. The launcher waits until the old Pi child has exited.
7. The launcher starts a new Pi child in the same working directory with structured arguments
   equivalent to:

   ```sh
   pi --session <exact-session-file>
   ```

8. The replacement confirms that it opened the expected session and working directory before it
   reports `Restart complete`.

The launcher must never start the replacement before the old Pi child exits.

## IPC contract

Use a private, validated protocol with the schema identifier `onurpi-restart-v1`.

The restart request carries only:

- request ID;
- session file;
- session ID;
- working directory;
- process generation.

The protocol must reject malformed values, stale generations, duplicate requests, unsupported schema
identifiers, and requests from a process that the launcher does not own. It must carry no
credentials, session contents, prompts, provider data, or unrelated environment data.

Only one restart request can be active for a Pi child. The extension must not call `ctx.shutdown()`
until it receives acceptance for that exact request.

## Launcher requirements

The restart-aware `pi` launcher must:

- stay in the foreground and keep ownership of the terminal;
- run Pi as a child with inherited standard input, output, and error streams;
- invoke the Pi executable with a separate argument array;
- never construct a shell command for process execution;
- preserve the current working directory;
- validate the exact session file and session ID before accepting a restart;
- accept no more than one restart for each Pi child generation;
- wait for the old child to exit before starting the replacement;
- avoid automatic restart loops;
- leave no orphaned child process;
- print the exact recovery command if a failure occurs after the old Pi process exits.

An ordinary Pi exit must also stop the launcher. It must not cause an automatic restart unless the
launcher accepted a restart request first.

## Startup argument policy

The launcher must use a conservative argument policy. It may restart only when it can build one
unambiguous replacement command for the exact session.

Reject automatic restart for:

- ephemeral sessions;
- startup prompts;
- session forks;
- RPC mode;
- print mode;
- unknown flags;
- ambiguous argument combinations.

The replacement command must contain exactly one explicit session selector for the current session.
It must not use `pi -c` or any latest-session lookup.

## Command requirements

`/restart` is a TUI-only command. It must:

- require a persisted session;
- require a compatible restart-aware launcher connection;
- read session identity through documented Pi APIs;
- wait for launcher acceptance;
- call `ctx.shutdown()` exactly once after acceptance;
- keep Pi running after rejection, timeout, invalid state, or lost IPC;
- show a clear failure reason and the exact manual recovery command;
- append no session entry and write no persistent state.

The package does not add an LLM-callable restart tool.

## Failure handling

Failures before launcher acceptance leave the current Pi process running. These failures include an
invalid or missing session file, unsupported mode, unsupported startup arguments, malformed IPC,
request timeout, and launcher rejection.

Failures after the old Pi process exits leave the session file unchanged. The launcher prints the
exact session path and manual command needed to resume it. It must not delete the session, select a
different session, or enter an unbounded retry loop.

A replacement reports success only after it confirms the expected session file, session ID, and
working directory.

## Package registration

Register `packages/restart/index.ts` through the root Pi manifest. Generate the canonical package
entry in tracked settings with the repository settings scripts. Do not edit `settings.json` by hand.

Keep the launcher entry point in the restart package. The package postinstall step must create or
repair only the stable `~/.local/bin/pi` link to that entry point. It must not replace unrelated
commands, modify the upstream Pi installation, change shell startup files, or change Herdr
configuration.

## Implementation plan

1. Create the private `@onurpi/restart` package with strict TypeScript, tests, this package's
   README, and a restart-aware `pi` entry point.
2. Add an idempotent package postinstall step that manages only `~/.local/bin/pi` and refuses to
   replace an unmanaged command.
3. Define and test the validated `onurpi-restart-v1` IPC protocol.
4. Implement the foreground launcher with structured process arguments and inherited terminal
   streams.
5. Implement and test the conservative startup argument policy.
6. Implement `/restart` as a TUI-only command that shuts Pi down only after launcher acceptance.
7. Enforce one Pi worker per session and old-child exit before replacement startup.
8. Add replacement confirmation for the expected session and working directory.
9. Add preflight, startup, timeout, recovery, signal, and orphan-process handling.
10. Register the extension in the root package manifest and generated settings.
11. Add unit, installer, process, real-Pi PTY, and isolated Herdr tests.
12. Run package checks, repository checks, Pi Reviewer against `main`, pull-request CI, package
    discovery, and a fresh-process smoke test.

## Tests

Unit and process tests must cover:

- valid and malformed IPC messages;
- stale generations and duplicate requests;
- startup without the restart-aware launcher connection;
- persisted and ephemeral sessions;
- unsupported modes and startup arguments;
- exact session file, session ID, and working directory values;
- no shutdown before launcher acceptance;
- one shutdown after acceptance;
- old-child exit before replacement startup;
- replacement startup failure and recovery output;
- signal handling;
- no automatic restart loop;
- no orphaned child process;
- paths that contain spaces, quotes, newlines, and shell metacharacters without shell execution.

A real-Pi PTY test must verify:

- the replacement has a different Pi worker PID;
- the session file and session ID stay the same;
- the working directory stays the same;
- the old process completes normal shutdown lifecycle handling;
- the replacement completes normal startup lifecycle handling;
- the replacement reloads the extension;
- the replacement accepts input;
- the final exit leaves no child process.

The real-Pi test must use temporary settings and session directories. It must not call a model,
write to real Pi state, or leave test processes running.

Run an isolated Herdr test through documented process and pane behavior. Verify that the same pane
survives the worker replacement and remains usable. Production code must not call Herdr APIs or
depend on Herdr internals.

## Verification

Run package checks and the restart tests:

```sh
npm run check --workspace @onurpi/restart
npm run slophammer --workspace @onurpi/restart
```

Run repository checks:

```sh
npm run check
npm run slophammer
git diff --check
npx -y @simpledoc/simpledoc check
```

Then run package discovery, a fresh Pi startup smoke test, the real-Pi PTY restart test, and the
isolated Herdr test. Run Pi Reviewer against `main` until no P0 or P1 findings remain. Open a pull
request and verify that its CI checks pass.

## Rollout and compatibility

The private OnurPi install provides the restart-aware launcher as the normal `pi` command. Users do
not need a second command after they start one new shell for the initial cutover. The stable
`~/.local/bin/pi` link remains in place when upstream Pi is reinstalled and discovers the updated
upstream executable on the next start.

Initial support is limited to persisted interactive sessions on POSIX terminals that pass the real
PTY tests. Ephemeral sessions, startup prompts, forks, RPC mode, print mode, unknown flags,
ambiguous arguments, and untested platforms fail closed.

No migration is required. The package adds no session schema, compatibility reader, service, daemon,
socket, state file, or persistent coordination data.

## Pi contract impact

- **Session state:** No restart entry is appended and no existing entry is changed.
- **Other persistent data:** Installation manages only the `~/.local/bin/pi` symlink. It adds no
  state file or settings schema.
- **Pi internals:** None.
- **Public API:** The extension uses `registerCommand`, documented session getters, lifecycle hooks,
  UI notifications, and `ctx.shutdown()`.

## Exclusions

This work does not include:

- detached replacement processes;
- `pi -c` or latest-session lookup;
- session-file writes, forks, clones, or truncation;
- Pi core or private API changes;
- services, daemons, sockets, or persistent restart stores;
- Herdr internals or Herdr production changes;
- shell aliases or shell startup-file changes;
- changes to the upstream Pi executable or installation;
- releases or deployment.
