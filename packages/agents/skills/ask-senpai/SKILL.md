---
name: ask-senpai
description: Use only when the human explicitly asks to call or use a senior expert model, specifically Claude Fable or GPT-6 Astra through Codex, for review, research, planning, or implementation. These models are very expensive to run, so use them sparingly even when authorized. Default to ACPX's local Claude adapter for Claude Fable, use ACPX's Cursor adapter when the human explicitly requests Cursor, and use ACPX's Codex adapter for GPT-6 Astra. Always select the model explicitly, use long timeouts and suitable permissions, preserve substantial work in persistent sessions, and verify results locally.
---

# Ask Senpai

Use this skill only when the human explicitly asks to call or use Claude Fable
or GPT-6 Astra through Codex. Do not infer permission from the task type,
difficulty, quality bar, failed local attempts, available budget, or potential
usefulness. If the human did not explicitly request one of these models, do not
invoke it; continue the work yourself or ask first.

Both models are very expensive to run. Use them sparingly in general, including
when the human has authorized them. Keep the scope and number of calls no larger
than the request requires. Never launch parallel calls unless the human
explicitly asks for parallel calls.

## Adapter Selection

- Claude Fable: use ACPX's `claude` adapter by default. Use ACPX's `cursor`
  adapter only when the human explicitly asks to run Fable through Cursor in the
  current request.
- GPT-6 Astra: use ACPX's `codex` adapter. Use it only when the human asks for
  Codex, OpenAI, or GPT-6 Astra by name.

Do not infer an adapter or model preference from task difficulty, quota errors,
adapter availability, or an earlier request. Never silently switch adapters or
models.

## Required Invocation

Always pass `acpx`, the adapter, and the model explicitly. Run from the target
repository or pass `--cwd <repo>`.

### Default: Claude Fable through local Claude Code

For a short or ordinary task, use a 30-minute timeout:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5-1 \
  --approve-reads --non-interactive-permissions deny \
  claude exec "$PROMPT"
```

For a very long task, use a 12-hour timeout and a named persistent session:

```bash
acpx --cwd "$REPO" --timeout 43200 claude sessions ensure --name senpai-fable
acpx --cwd "$REPO" --timeout 43200 \
  --model claude-fable-5-1 \
  --approve-reads --non-interactive-permissions deny \
  claude -s senpai-fable "$PROMPT"
```

### GPT-6 Astra through Codex

Use the bare advertised model id `gpt-6-astra`:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model gpt-6-astra \
  --approve-reads --non-interactive-permissions deny \
  codex exec "$PROMPT"
```

For a very long task, use a 12-hour timeout and a named persistent session:

```bash
acpx --cwd "$REPO" --timeout 43200 codex sessions ensure --name senpai-codex
acpx --cwd "$REPO" --timeout 43200 \
  --model gpt-6-astra \
  --approve-reads --non-interactive-permissions deny \
  codex -s senpai-codex "$PROMPT"
```

The Codex adapter advertises bare model ids. It rejects an effort suffix such as
`gpt-6-astra[xhigh]` with `did not advertise that model`, and its error message
lists the ids it does advertise. Select reasoning effort separately, either in
the Codex configuration or as a session option:

```bash
acpx --cwd "$REPO" codex set reasoning_effort xhigh
```

### Explicit Cursor override

When the human explicitly requests Cursor, replace the adapter consistently in
both session setup and invocation:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5-1 \
  --approve-reads --non-interactive-permissions deny \
  cursor exec "$PROMPT"
```

For substantial Cursor work, use a named Cursor session:

```bash
acpx --cwd "$REPO" --timeout 43200 cursor sessions ensure --name senpai-fable
acpx --cwd "$REPO" --timeout 43200 \
  --model claude-fable-5-1 \
  --approve-reads --non-interactive-permissions deny \
  cursor -s senpai-fable "$PROMPT"
```

Use 12 hours for deep repository audits, large implementations, long test loops,
or work where restarting would lose substantial progress. Do not use a shorter
ACPX timeout merely because the calling tool polls more frequently; keep polling
the running process until ACPX exits.

## Permissions

- For review, research, or planning, use `--approve-reads` with
  `--non-interactive-permissions deny` and tell the model not to edit files.
- For implementation, use `--approve-all` only when the human explicitly
  authorized the model to make delegated edits and execute commands.
- ACPX permission modes are mutually exclusive.

## Working Rules

- Reconfirm that the human explicitly requested the model before every new
  session or additional call.
- State the task, scope, constraints, expected evidence, and output format.
- Omit low `--max-turns` limits unless the human explicitly requests one.
- For substantial work, prefer a named session so interrupted output can be
  recovered with `acpx claude sessions history <name>` by default,
  `acpx codex sessions history <name>` for GPT-6 Astra, or
  `acpx cursor sessions history <name>` when Cursor was explicitly requested.
- Treat the answer as advisory. Verify findings, edits, and tests locally before
  acting on or reporting them.
- If ACPX rejects the model identifier, read the models the selected adapter
  advertises, use its exact identifier, and do not silently fall back to another
  model or adapter.
