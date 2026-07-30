---
name: regrafter
description:
  Delegate maintenance of Regraft-managed vendored code to the dedicated Regrafter agent, including
  starting or recovering a run, relaying decisions, resuming the same Pi session, attaching
  interactively, or aborting with verified repository handoff.
---

# Regrafter driver

Use this skill only when the user explicitly asks to use Regrafter or when a vendored-code
maintenance request should be delegated to the installed dedicated app.

## Start

1. Resolve `scripts/regrafter.mjs` relative to this `SKILL.md` and keep its absolute path as
   `<driver>`. Run `node <driver> --help` to verify the bundled controller. Do not replace it with
   ad hoc Regraft commands.
2. Put the exact delegated request in a temporary file outside the target repository.
3. Name authority explicitly with `--allow`. Use `commits` only when overlay commits are authorized.
   Add `push` or `pull-requests` only when the user authorized them.
4. Start the run and parse its JSON result:

```bash
node <driver> start --repo /path/to/repository --request-file /tmp/task.md --allow commits --json
```

Delete the temporary request file after the command reads it. While the run owns the repository
lease, treat the target worktree as read-only. Do not edit, stage, commit, reset, clean, or run
another updater there.

## Decisions

A `needs_decision` result is a handoff, not a failure. Read its question, options, effects, files,
evidence, recommendation, and repository snapshot.

Answer directly only when existing user instructions clearly select an option. Otherwise show the
decision to the user and wait. Silence does not approve the recommendation.

Resume with the exact run and decision ids. Put the answer in a temporary file:

```bash
node <driver> send run-id --decision decision-id --message-file /tmp/answer.md --json
```

Use `--allow` on `send` only when the user expands the run's authority. A run may ask more than one
decision. Keep using the same run id.

## Recovery

After conversation compaction or restart, recover the run without scanning Pi sessions:

```bash
node <driver> list --repo /path/to/repository --json
node <driver> inspect run-id --json
```

An `interrupted` run may resume only when the controller's repository checks pass. If a person
should take over the same session, use `node <driver> attach run-id`. Do not start a second run for
the repository.

Use `node <driver> abort run-id --json` only when ending delegation. Abort does not reset files. It
releases the lease only after verified handoff. If abort stays blocked, preserve the lease and
report the needed manual input.

## Reporting

Report Regrafter's exact state, commits, checks, updated upstream revisions, and remaining risks. Do
not claim that the main agent edited or verified leased files. On `blocked` or `failed`, include the
controller's evidence, attempted actions, recovery status, and next required input.
