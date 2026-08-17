---
name: agent-blurb
description: Write README prompts that tell coding agents how to adopt a tool.
---

# Agent Blurb

Use this skill to write a short README blurb that a human can copy into a
coding agent. Default to the shortest prompt that still tells the agent what
to use, where to start, what to ask, and how to verify.

## Principles

- Treat the blurb as setup instructions for an agent, not product marketing.
- Address two audiences:
  - Human lead-in text says when to copy the block and what it will do.
  - The fenced block addresses the coding agent directly.
- Prefer 4-8 lines inside the fenced block. Go longer only when setup has
  multiple real steps.
- Keep the surrounding human lead-in to one short sentence when possible.
- Wrap prose and prompt text to 80 characters or less when practical.
- Put the prompt in a fenced `text` code block so GitHub renders a clean
  copyable block.
- Start the prompt with the desired outcome and the project or tool name.
- For durable agent workflows, prefer adding a real agent entrypoint instead
  of packing the whole procedure into the README prompt.
- Point to the source of truth before asking the agent to change files. Use an
  `AGENT_ENTRYPOINT.md`, install doc, README section, or stable raw URL when
  the repo has one.
- Include exact commands only when they are essential. Otherwise, point to the
  source of truth.
- Ask the user only for facts the agent cannot infer, such as target repo, OS,
  account choice, secret location, or approval for destructive actions.
- Tell the agent how to verify the result and what to report back.
- Make the instructions idempotent: inspect existing setup first, then update
  it instead of duplicating config.
- Include safety boundaries only when the task can touch secrets, external
  writes, or destructive actions.
- Avoid branding the section as "Agent Blurb". Name it as an action the reader
  can take.

## README Placement

Group the blurb with the existing install, quickstart, or setup instructions.
Do not create several separate agent sections.

Good section names:

- `## Quick setup: tell your agent about <Tool>`
- `## Quick setup - tell your agent about <Tool>`
- `### Ask your coding agent (recommended)`
- `### Agent-assisted setup`

Use a top-level quick setup section when the README has no install section yet.
Use a subsection when the README already has an install, quickstart, or setup
section.

## Agent Entrypoints

Add or update an agent entrypoint when the tool needs a repeatable operational
workflow, safety boundaries, validation steps, or final reporting expectations.
Do not create one for a tiny one-shot prompt where a README anchor is enough.

Use this pattern:

1. Add `docs/AGENT_ENTRYPOINT.md` as the source of truth for agents.
2. Add or update a root `AGENTS.md` with a short pointer to that entrypoint.
3. Add a README quick setup section with a copyable prompt that points to the
   entrypoint, preferably through a stable raw URL for published repositories.

Keep the entrypoint operational rather than promotional. It should usually
cover:

- what the agent should do before changing files
- how to inspect the target repository or existing setup
- how to choose inputs, configuration, or implementation path
- what commands or tool modes to run
- how to inspect generated artifacts or results
- what requires user confirmation before applying changes
- what local checks to run before finishing
- what to report back

Keep `AGENTS.md` short. It should route agents to the entrypoint and add only
repo-specific rules that are enforceable or important locally. Do not duplicate
the full entrypoint there.

Keep the README prompt short once an entrypoint exists. The prompt should state
the desired outcome, point to the entrypoint before asking for changes, and tell
the agent to follow it and report unsupported setup or missing choices.

## Workflow

1. Inspect the README and install docs to find the natural setup section.
2. Decide whether the task needs a durable agent entrypoint. Add one when the
   workflow is more than a short prompt.
3. If adding an entrypoint, create or update `docs/AGENT_ENTRYPOINT.md` and a
   short root `AGENTS.md` pointer before editing the README prompt.
4. Start the README prompt with a short source-of-truth pointer. Expand only if
   the agent would otherwise miss important setup steps.
5. Add a short human lead-in followed by one fenced `text` block.
6. Keep the block short, direct, and wrapped to 80 characters.
7. Cut any line that repeats the README or does not change agent behavior.

## Template

````md
### Ask your coding agent (recommended)

Copy this block and paste it into your coding agent when you want it to
<outcome>.

```text
Use <Tool> to <outcome> for this project.

Attention agent: start here before changing files:
<url-or-path>

Inspect the existing setup, update it in place, verify with <checks>, and
ask me only for missing choices: <choices>.
```
````

Add safety lines only when they are relevant:

````md
```text
Ask before destructive changes or external writes. Never ask me to paste
secrets into chat; use placeholders or local files.
```
````

Prefer an even shorter prompt when the project already has a strong agent
entrypoint:

````md
## Quick Setup: Tell Your Agent About <Tool>

Copy this block into your coding agent to use <Tool> in this repository.

```text
Use <Tool> to <outcome> for this project.

Attention agent: start with this file before changing files:
<raw-url-or-repo-path>

Follow it exactly. Report if the requested setup is unsupported.
```
````

For new entrypoints, keep examples schematic and adapt the section names to the
tool:

````md
# Agent Entrypoint

Attention agent: start here when you are asked to use <Tool> for <outcome>.

## Operating Rules

## First Pass

## Run Or Configure The Tool

## Inspect Results

## Apply Changes

## Validation

## Final Report
````
