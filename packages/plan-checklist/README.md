# @onurpi/plan-checklist

`@onurpi/plan-checklist` is a branch-aware checklist extension for Pi. Its `update_plan` tool keeps
the current task plan visible above the editor throughout a long Pi session.

Each update replaces the complete checklist with a new ordered snapshot of task progress. The model
can use `pending`, `in_progress`, or `completed` while keeping at most one active step. Pi renders
the update in the main transcript and stores the successful tool call and result in its normal
session history.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/plan-checklist
```

```text
/reload
```

The extension has no settings or commands. The model uses `update_plan` automatically for multi-step
work.

## Update format

A call contains the complete ordered checklist:

```json
{
  "explanation": "Implementation is complete, so verification is active.",
  "plan": [
    { "step": "Inspect the implementation", "status": "completed" },
    { "step": "Add the behavior", "status": "completed" },
    { "step": "Run the checks", "status": "in_progress" }
  ]
}
```

`explanation` is optional and appears with that transcript update. It is not part of the current
plan state. An empty `plan` clears the widget.

The extension rejects blank steps, plans with more than 64 steps, step text longer than 500
characters, explanations longer than 2,000 characters, and plans with several active steps.
Duplicate steps and direct status changes are allowed.

## Sessions and compaction

The latest successful `update_plan` tool result on the active branch supplies the current state. The
current plan stays branch-correct when Pi reloads or the user navigates, forks, or compacts the
session. This needs no separate file or database. Failed and malformed tool results leave the
previous plan unchanged.

When compaction removes the latest plan call from model context, the extension adds the current
snapshot to the next provider context through Pi's public `context` hook. This message is transient
and hidden. It is never appended to the session.

The widget appears only in TUI mode. Tool calls and results continue to work through RPC/JSON/print
interfaces and in `--no-session` mode. An ephemeral session loses its plan when the process exits.

## Scope

Plan state is model-authored. The extension does not infer completion from commands, changed files,
or test output, so a completed marker is not proof that verification passed. It does not implement
Pi Plan mode, human checklist editing, external issue tracking, priorities, dependencies, or stable
step IDs.

The request model follows Codex's full-snapshot checklist described in
[`docs/codex-update-plan-spec.md`](../../docs/codex-update-plan-spec.md). OnurPi adds bounded text
input and enforces the one-active-step rule that Codex gives the model as guidance.
