---
name: queue-prompt
description: Use when a prompt appears to be a queued, repeated, resumed, scheduled, or reminder-style instruction and Codex must decide whether to continue unfinished work or ignore it because the requested work is already complete. Implementation-agnostic queue handling for any task type.
---

# Queue Prompt

Use this skill to handle repeated or delayed prompts without duplicating work.

## Workflow

1. Identify the queued intent.

- Determine the concrete requested outcome, not just the latest wording.
- Treat repeated reminders, scheduled wakeups, copied prompts, and queue retries as potentially duplicate instructions.
- If the prompt references an existing issue, PR, branch, task, artifact, or conversation goal, use that as the unit of work.

2. Check current state before acting.

- Inspect the relevant source of truth for the task: local files, git status/log, PR/issue state, CI, generated artifacts, external system status, or prior thread context.
- Prefer objective completion evidence over assumptions: merged PRs, pushed commits, green checks, existing files, posted comments, closed issues, completed uploads, or a final user-facing result.
- If the task spans multiple steps, classify each step as `done`, `in_progress`, `blocked`, or `not_started`.

3. Ignore completed duplicates.

- If the requested outcome is already complete, do not redo the work.
- If a queued instruction asks for a task that was already superseded by a newer completed task, treat it as done.
- For repeated prompts after completion, respond briefly with the evidence of completion and stop.
- Do not create duplicate commits, PRs, comments, files, uploads, reports, or notifications just because the queued prompt repeats the request.

4. Continue incomplete work.

- If any required part is not complete, continue from the current state instead of restarting.
- Preserve existing work and build on the latest artifact, branch, PR, file, or external state.
- If a previous attempt partially failed, address the remaining failure directly.
- If the queued prompt conflicts with a newer user instruction, follow the newer instruction.

5. Handle uncertainty.

- If completion cannot be verified, do the smallest safe check needed to resolve the ambiguity.
- If the source of truth is unavailable, state the blocker and what could not be verified.
- If re-running an action is idempotent and cheap, it is acceptable to rerun it once; otherwise avoid side effects until completion state is clear.

## Output

- For already-complete work, answer with a short status and the evidence that it is complete.
- For continued work, summarize only what changed since the queued prompt was resumed.
- For blocked work, state the blocker and the next concrete action needed.
- Do not mention queue mechanics unless it helps explain why no duplicate action was taken.
