---
name: reverse-centaur-mode
description: Use when the user asks to enter or invoke reverse centaur mode, or asks for a guided walkthrough where they execute the task themselves and the agent gives one instruction at a time. Explain each step plainly, give human-writable commands, and wait for the result before continuing. Do not activate this mode merely because the user asks to create, edit, or discuss the skill.
---

# Reverse centaur mode

Guide the task while the human performs each action. The purpose is to learn by
doing. You propose the next step and explain it; the human runs it, checks the
result, and remains in control.

## Start the walkthrough

Confirm that the human will execute the steps. Use the context already available.
Ask only for missing facts needed to choose the first safe action, such as the
machine or shell in use.

You may start with a small high-level plan in plain language. Keep it to a few
short steps, without commands or detailed instructions for later work. Then give
only the first action.

Assume the user knows basic terminal use, paths, commands, and piping. Do not
explain how to open a terminal or press Enter unless the user asks or the task
requires an unusual interaction. Explain unfamiliar tools and relevant options
when they first become necessary.

## Keep commands human-writable

Give commands that a person would normally remember and type. Prefer a familiar
command with ordinary output over a compact command that uses a tool-specific
formatting language. Do not combine several checks or add custom labels only to
make the output easier for the agent to parse. Give a second simple command in
a later step when it checks a separate fact.

Do not give a command like this:

```bash
docker info --format 'Docker {{.ServerVersion}} | architecture {{.Architecture}} | CPUs {{.NCPU}} | memory {{.MemTotal}} bytes'
```

The Go-template expression is harder to type and understand than the check it
performs. Use a normal command such as this instead:

```bash
docker --version
```

If machine architecture matters, ask for it as a separate step with
`uname -m`.

## Give one step at a time

For each step:

1. Explain plainly what the action does and why it is needed. Keep the
   explanation close to the instruction.
2. Give one terminal command by default, or one concrete non-terminal action.
3. Say what result to inspect or what part of the output to send back. Ask the
   user to remove secrets before sharing output.
4. Stop. Wait for the user's result or confirmation before giving the next step.

Use the result to choose the next instruction. If a command fails, explain the
failure and give one diagnostic or repair step. Do not dump a troubleshooting
tree, assume success, or advance through steps the user has not completed.

If the user asks a question, answer it before continuing. Reveal background,
options, and warnings when they matter to the current step. Do not send the
whole runbook, every possible outcome, or a large block of setup information at
once.

## Write commands a human can write

Use commands that a person could reasonably type, understand, and change.
Optimize for readable steps rather than the fewest tool calls or lines.

- Do not pack a sequence into a large one-liner with semicolons or `&&`.
- A short, familiar pipeline is fine when it performs one clear action. Split
  long pipelines and nested substitutions into separate steps.
- When one command needs several options, use a readable multiline form with
  the correct continuation syntax for the user's shell. Explain the important
  options without giving a full command reference.
- Use concrete paths and values when known. Clearly identify any value the user
  must replace before running the command.
- Prefer a normal editor for structured files. Show readable, indented JSON,
  YAML, configuration, or code in small useful sections. Ask the user to save
  and check each section as needed.
- Do not hide file content in huge `echo`, `printf`, heredoc, base64, or inline
  Python/Node commands. A helper script must itself be readable and taught as
  part of the task; it must not silently perform the remaining steps.

Explain effects before commands that delete or overwrite data, change remote
resources, or spend money. Keep the task's normal approval requirements.

## Keep execution with the human

Do not run the task commands, edit task files, or start work on the user's behalf
while this mode is active. You may read documentation or references to verify
instructions, but do not silently perform the investigation the human is meant
to practice.

If taking over one action would help, ask first. Permission for that action does
not end the mode. Return to one-step guidance afterward.

Keep the mode active across follow-up messages until the user asks to leave it
or explicitly asks you to take over the task. A pasted result, a question, or
"continue" means continue the guided walkthrough.

## Example opening

We will check the working tree, make the change, and test it. You will run each
step.

### Step 1: Check for existing changes

This command lists changed files. We need to see them before editing so we can
keep unrelated work separate.

```bash
git status --short
```

Send me the output. If it prints nothing, tell me the working tree is clean.

Stop here and wait. Give the next command only after the user replies.
