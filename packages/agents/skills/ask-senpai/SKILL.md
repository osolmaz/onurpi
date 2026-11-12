---
disable-model-invocation: true
name: ask-senpai
description:
  Use only when the human explicitly asks to call or use a senior expert model, specifically Claude
  Fable, GPT-6 Astra, or GPT-6.1 Sol through Codex, for review, research, planning, or
  implementation. These models are very expensive to run, so use them sparingly even when
  authorized. Start the model as an interactive session in a Herdr Core terminal (`hc`) that the
  human can watch and steer; do not use ACPX or a one-shot print mode. Always select the model
  explicitly, give the session a narrow task and written limits, carry messages yourself, and verify
  results locally.
---

# Ask Senpai

Use this skill only when the human explicitly asks to call or use Claude Fable, GPT-6 Astra, or
GPT-6.1 Sol through Codex. Do not infer permission from the task type, difficulty, quality bar,
failed local attempts, available budget, or potential usefulness. If the human did not explicitly
request one of these models, do not invoke it; continue the work yourself or ask first.

These models are very expensive to run. Use them sparingly in general, including when the human has
authorized them. Keep the scope and number of sessions no larger than the request requires. Never
start parallel sessions unless the human explicitly asks for them.

## Why a Herdr Core terminal

The senior model runs as a normal interactive agent session in a terminal that `hc` keeps alive.
The human can open that terminal, read every step, and type into it. The session keeps its
conversation, so a follow-up question or new data goes to the same session. A hidden one-shot
call gives none of this, and a command that runs inside your own shell dies when your turn is
interrupted.

Read the `herdr` skill first. It needs `HC_TERMINAL_ID`; if you are not inside Herdr Core, say so
and stop. Do not fall back to ACPX or to a print mode on your own.

## Adapter selection

- Claude Fable: the `claude` CLI.
- OpenAI models (GPT-6 Astra, GPT-6.1 Sol): the `codex` CLI. Use it only when the human asks for
  Codex, OpenAI, or one of these models by name.
- Cursor: only when the human explicitly asks to run the model through Cursor in the current
  request. Start the Cursor agent CLI in a terminal in the same way.

Do not infer an adapter or model preference from task difficulty, quota errors, CLI availability,
or an earlier request. Never silently switch adapters or models.

## Start the session

Give the session its own working folder: the target repository, or a separate Git worktree of it
when the model may write files. Write the task to a file first, so that the same text can be sent
again after an interruption.

### GPT-6 Astra through Codex

```bash
hc run --bg --keep --name senpai-astra --cwd "$REPO" -- \
  codex --no-daemon -m gpt-6-astra --approve-for-me
hc wait senpai-astra
hc read --lines 40 senpai-astra        # resolve a trust or update dialog before you send
hc send senpai-astra "$(cat "$PROMPT_FILE")"
```

- `--no-daemon` keeps Codex's commands inside the `hc` terminal.
- Decline an update dialog of the CLI unless the human asked for the update.
- Select reasoning effort in the Codex configuration or with the session's own command, not as a
  suffix of the model id.

### Claude Fable through Claude Code

```bash
hc run --bg --keep --name senpai-fable --cwd "$REPO" -- \
  claude --model claude-fable-5-2
hc wait senpai-fable
hc send senpai-fable "$(cat "$PROMPT_FILE")"
```

### Model ids

Pass the bare model id that the CLI advertises, such as `gpt-6-astra`. When the human names a model
that the CLI rejects, try the exact requested id once, then report the ids that the CLI lists and
ask which one to use; do not substitute silently. Check the list again after a CLI update before
you assume that a new release is unavailable.

### Continue an earlier session

A session that is still live takes a new message with `hc send`. For a session that ended, resume
its conversation in a new terminal instead of starting from nothing:

```bash
hc run --bg --keep --name senpai-astra --cwd "$REPO" -- \
  codex resume "$SESSION_ID" --no-daemon -m gpt-6-astra --approve-for-me
hc run --bg --keep --name senpai-fable --cwd "$REPO" -- \
  claude --model claude-fable-5-2 --resume "$SESSION_ID"
```

## Permissions

- For review, research, or planning, tell the model in the task not to edit files, and start it in
  a mode that asks before it writes.
- For implementation, or for research in which the model must run its own scripts, use the CLI's
  automatic approval mode with its sandbox (`--approve-for-me` for Codex) only when the human
  authorized the model to edit and to run commands. Never start a session without a sandbox or with
  all approvals bypassed unless the human orders exactly that.
- If the permission system of your own session refuses the start, do not work around it. Report
  the refusal and give the human the command to run.
- Write the limits into the task itself: the folder it may write to, the commands it may run, no
  commit or push, no network, and the project's own rules.

## Carry the messages

You are the messenger between the senior model and the rest of the work.

- Wait with `hc wait senpai-astra`, never with sleep or polling. Read the screen before you
  summarize anything.
- When the session is `blocked` on its own dialog or question, read it. Answer a question about
  the task from facts that you have or can get; pass a question that only the human can decide to
  the human. Do not guess.
- When the model asks for data, get it from the session or person that owns it and send it as a
  message or as a file in the model's folder.
- Ask for long answers as a file in its folder, and read that file.
- Leave the terminal open when the work may continue. Close it only when the human says so or the
  task is done and its results are saved.

## Working rules

- Reconfirm that the human explicitly requested the model before every new session.
- State the task, scope, constraints, expected evidence, and output format.
- Ask the model to guard its own result: to separate the data it selects on from the data it tests
  on, to count what it tried, and to say what stays open.
- Treat the answer as advisory. Verify findings, edits, and tests yourself, with your own check,
  before you act on them or report them.
- Results that the project keeps go into the repository through its normal path; files in a
  temporary worktree are not saved.
