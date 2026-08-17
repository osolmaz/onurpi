---
name: acpx
description: Use when calling, reviewing with, or delegating work to another coding agent through the ACPX CLI, including explicitly human-requested Claude Fable through the default local Claude adapter or an explicitly requested Cursor adapter, one-shot and persistent sessions, model selection, permissions, timeouts, output collection, and recovery after interrupted calls.
---

# ACPX

Use `acpx` for agent-to-agent work instead of scraping an interactive terminal.

## Required defaults

- Run from the target repository or pass `--cwd <repo>` so the agent sees the
  intended checkout and repository instructions.
- Pass `--timeout 1800` for every prompt, exec, compare, or flow run unless the
  user explicitly asks to hurry or specifies another timeout.
- Do not shorten the ACPX timeout merely to fit the caller's polling window.
  Start the command as a long-running process and keep polling it.
- Avoid low `--max-turns` values for audits and implementation work. Omit the
  option unless a turn cap is intentional.
- Treat another agent's answer as advisory. Verify findings against repository
  state and local test results before reporting or editing.

## Session mode

Use a one-shot temporary session only when no follow-up or recovery is likely:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --approve-reads --non-interactive-permissions deny \
  claude exec "$PROMPT"
```

Use a named persistent session for deep reviews, implementation, long reports,
or any task likely to need clarification or continuation:

```bash
acpx --cwd "$REPO" --timeout 1800 claude sessions ensure --name fable-review
acpx --cwd "$REPO" --timeout 1800 \
  --approve-reads --non-interactive-permissions deny \
  claude -s fable-review "$PROMPT"
```

Persistent sessions make interrupted output recoverable. Inspect them with:

```bash
acpx --cwd "$REPO" claude status -s fable-review
acpx --cwd "$REPO" claude sessions show fable-review
acpx --cwd "$REPO" claude sessions history fable-review --limit 20
```

## Claude Fable

Call Fable only when the human explicitly asks to use or call Fable. Fable is
very expensive, so use it sparingly even when authorized. Never infer permission
from task difficulty or failed attempts, and never launch parallel Fable calls
unless the human explicitly requests them.

Default to ACPX's `claude` adapter, which invokes the locally installed Claude
Code CLI, and request Fable explicitly:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  claude exec "$PROMPT"
```

Use ACPX's `cursor` adapter only when the human explicitly asks to run Fable
through Cursor in the current request:

```bash
acpx --cwd "$REPO" --timeout 1800 \
  --model claude-fable-5 \
  --approve-reads --non-interactive-permissions deny \
  cursor exec "$PROMPT"
```

Do not infer a Cursor preference from quota errors, adapter availability, task
difficulty, or an earlier request. Never silently switch adapters.

Model identifiers are adapter-defined. Read the model advertised by the selected
adapter. If it reports a more exact identifier, use that exact identifier when
the bare name is ambiguous. Do not silently substitute a different model or
adapter.

## Permissions

- For review, research, and planning, use `--approve-reads` with
  `--non-interactive-permissions deny`. Tell the agent not to edit.
- Use `--approve-all` only when the user has authorized the delegated agent to
  edit and execute the required work.
- Use `--policy <file-or-json>` when permissions need narrower tool-specific
  control.
- ACPX permission flags are mutually exclusive.

## Prompts and output

- State the target, scope, constraints, expected evidence, and output format.
- Ask for exact file and line references for review findings.
- Ask the agent to distinguish new findings from issues already covered by a
  plan, intentional behavior, and false positives.
- Use `--format text` while monitoring work, `--format quiet` when only the final
  answer is needed, and `--format json --json-strict` for machine consumption.
- For a long audit, ask for a concise final report but do not reduce the timeout.
- Keep polling until ACPX exits. Do not report completion while its process is
  still running.

## Recovery

- Prefer a persistent named session when losing the final answer would require
  repeating expensive repository analysis.
- If a call is interrupted, inspect session status and history before starting a
  replacement audit.
- Continue the same named session with a short prompt asking it to emit the
  pending final report.
- Cancel obsolete work with `acpx <agent> cancel -s <name>` or interrupt the
  active process so ACPX can send cooperative `session/cancel`.
- If the command itself times out, increase the timeout. Do not respond by
  constraining the agent to an artificially small turn budget.

Use `acpx --help` and `acpx <agent> --help` when the installed CLI differs from
these examples. The installed ACPX package also ships its full reference skill
under `skills/acpx/SKILL.md`.
