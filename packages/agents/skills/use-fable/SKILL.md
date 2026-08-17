---
name: use-fable
description: Use only when the human explicitly asks to call or use Claude Fable for review, research, planning, or implementation. Fable is very expensive to run, so use it sparingly even when authorized. Default to ACPX's local Claude adapter, but use ACPX's Cursor adapter when the human explicitly requests Cursor. Always select Fable explicitly, use long timeouts and suitable permissions, preserve substantial work in persistent sessions, and verify results locally.
---

# Use Fable

Use this skill only when the human explicitly asks to call or use Claude Fable.
Do not infer permission from the task type, difficulty, quality bar, failed local
attempts, available budget, or potential usefulness. If the human did not
explicitly request Fable, do not invoke it; continue the work yourself or ask
first.

Fable is very expensive to run. Use it sparingly in general, including when the
human has authorized it. Keep the scope and number of calls no larger than the
request requires. Never launch parallel Fable calls unless the human explicitly
asks for parallel calls.

Use ACPX's `claude` adapter by default. Use ACPX's `cursor` adapter only when
the human explicitly asks to run Fable through Cursor in the current request.
Do not infer a Cursor preference from task difficulty, quota errors, adapter
availability, or an earlier request. Never silently switch adapters.

## Required Invocation

Always pass `acpx` and `--model claude-fable-5` explicitly. Run from the target
repository or pass `--cwd <repo>`.

### Default: local Claude Code

For a short or ordinary task, use a 30-minute timeout:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  claude exec "$PROMPT"
```

For a very long task, use a 12-hour timeout and a named persistent session:

```bash
acpx --cwd "$REPO" --timeout 43200 claude sessions ensure --name fable-work
acpx --cwd "$REPO" --timeout 43200 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  claude -s fable-work "$PROMPT"
```

### Explicit Cursor override

When the human explicitly requests Cursor, replace the adapter consistently in
both session setup and invocation:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  cursor exec "$PROMPT"
```

For substantial Cursor work, use a named Cursor session:

```bash
acpx --cwd "$REPO" --timeout 43200 cursor sessions ensure --name fable-work
acpx --cwd "$REPO" --timeout 43200 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  cursor -s fable-work "$PROMPT"
```

Use 12 hours for deep repository audits, large implementations, long test loops,
or work where restarting would lose substantial progress. Do not use a shorter
ACPX timeout merely because the calling tool polls more frequently; keep polling
the running process until ACPX exits.

## Permissions

- For review, research, or planning, use `--approve-reads` with
  `--non-interactive-permissions deny` and tell Fable not to edit files.
- For implementation, use `--approve-all` only when the human explicitly
  authorized Fable to make delegated edits and execute commands.
- ACPX permission modes are mutually exclusive.

## Working Rules

- Reconfirm that the human explicitly requested Fable before every new session
  or additional call.
- State the task, scope, constraints, expected evidence, and output format.
- Omit low `--max-turns` limits unless the human explicitly requests one.
- For substantial work, prefer a named session so interrupted output can be
  recovered with `acpx claude sessions history <name>` by default or
  `acpx cursor sessions history <name>` when Cursor was explicitly requested.
- Treat Fable's answer as advisory. Verify findings, edits, and tests locally
  before acting on or reporting them.
- If ACPX rejects the model identifier, inspect the models advertised by the
  selected adapter and use its exact Claude Fable identifier. Do not silently
  fall back to another model or adapter.
