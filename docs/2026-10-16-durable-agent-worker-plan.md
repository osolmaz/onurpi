---
title: A personal agent on Pi Durable, reached through Discord
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-10-16
tags: [pi, durable, discord, openshell, sandbox, agents]
---

# A personal agent on Pi Durable, reached through Discord

## Purpose

Onur wants a personal agent built on Pi Durable (`@earendil-works/pi-durable`) that he talks to
mainly through Discord, and a safer way for agents on his machine to reach credentials and root.

Two findings drive the design. First, any agent that runs as Onur's own user can become root,
because that user has passwordless sudo and is in the `docker` group. A credential broker on the
same machine therefore protects nothing from such an agent. Second, Pi Durable separates the agent's
state from the place where its tools run. The `@earendil-works/pi-env` README describes the intended
split: the tools run elsewhere "while the Durable worker, its storage and credentials stay local."

This plan uses that split. A worker process holds the secrets and the agent's storage. The model
acts only through tools, and the tools run in a sandbox that holds none of those secrets. This
document is the canonical plan for that worker and its Discord adapter.

## End state

- One worker process runs the personal agent on Pi Durable, with SQLite storage. A crash or restart
  continues unfinished work, and a Discord message is never answered twice.
- Onur talks to the agent in Discord: in direct messages and in the channels he allows. Nobody else
  can start a turn.
- The agent's file and command tools run in an OpenShell sandbox through `pi-env`. The sandbox holds
  no secrets and cannot use sudo or Docker.
- The worker runs as an operating-system user that no agent controls.
- Scheduled jobs reach the agent from a scheduler on the host, which only submits prompts and never
  runs an agent itself.
- A tool call that needs approval waits for Onur's answer, given in Discord or on his phone.

## Pi Durable in short

Pi Durable is a library, not a program, and is marked experimental: its API changes without notice
between releases. Version 1.2.0 is current. The `pi` CLI does not use it. The worker described here
is the program that uses it.

Everything Durable does is an atomic commit to storage before anyone sees it. A conversation is a
list of immutable entries. Work runs as tasks that save a checkpoint at every step: `pi.generation`
calls the model, and each tool call is its own `pi.tool` task. After a crash, a tool runs again only
when it is marked `replay: "safe"`; otherwise the model gets an `interrupted` result with the output
saved so far.

Input arrives as submissions. A submission with a `requestId` that was already admitted returns the
existing submission, which is how a restart avoids answering one message twice. Input that arrives
while the agent works waits in the conversation's inbox, as a steer or a follow-up.

Behaviour comes from extensions: tools, system prompt sections, and hooks. `ToolTask` has
`beforeTool` and `afterTool` hooks, and `GenerationTask` has `beforeRequest`, `afterResponse`,
`onYield`, and `afterTools`. Tools reach files and processes only through an `ExecutionEnv` chosen
per conversation, which can be local, a container, or a remote machine through `pi-env`.

## Process layout

```text
Discord ──► worker (Pi Durable, SQLite, model keys, Discord token)
               │         ▲
               │         └── local submit socket ◄── host scheduler
               │
               └── pi-env over SSH ──► OpenShell sandbox (files, bash, git)
```

The worker runs as a dedicated user, for example `agentd`. That user cannot use sudo or Docker, and
it runs no agent CLI. Onur's own user cannot read its files. The worker reads its configuration and
secrets from that user's home and never passes them to the sandbox.

The sandbox is where the model's actions happen. Its workspace holds the agent's repositories and
skills. OpenShell confines it with Landlock and seccomp in its own network namespace, where every
outbound connection that no rule allows is denied.

## Packages

Both packages live in OnurPi for now, under `packages/`, and are not Pi CLI extensions: they stay
out of the root Pi manifest and the settings sync. Both stay private, and neither is published to
npm without a separate decision. Personal configuration never goes into OnurPi. The agent's
instructions, the Discord ids, and the tokens live in the worker user's configuration.

- `packages/discord-adapter`: connects Discord to Pi Durable conversations. It depends on Pi Durable
  and discord.js, and on nothing else in OnurPi, so it can move to its own repository later.
- `packages/agent-worker`: the program. It opens the Durable harness with its extensions and
  execution environment. It also starts the Discord adapter and the submit socket, and it handles
  restarts.

Pi Durable, `pi-env`, and Chord are pinned to exact versions, because their APIs change between
releases.

## Discord adapter

Two existing projects serve as references for designs, not as code to copy. `pi-roundtable` is the
most actively maintained Discord host for Pi. Its approval cards and slash commands are useful
models. So are the way it reads the messages around an addressed message, its attachment downloads
with deadlines, and how it finishes running work before a stop. `@llblab/pi-telegram` is the best
maintained chat adapter for Pi, and shows how a chat maps onto a Pi session.

Behaviour:

- **Access.** Only Onur's Discord user can start a turn or answer an approval. The adapter ignores
  every other author, including other bots. Allowed channels are listed in the configuration.
- **Conversations.** Each direct-message channel and each allowed server channel maps to one Durable
  conversation, stored in an adapter document. A thread maps to its own conversation, forked from
  the channel's conversation at the message that started it.
- **Input.** A message becomes an input submission with `requestId` set to the Discord message id,
  so a message seen again after a restart is not answered twice. While the agent works, a new
  message is a follow-up by default. A message that starts with a configured prefix is a steer.
- **Output.** The adapter follows the conversation with `watchEvents`. It posts one reply per run
  and edits it while text streams, no more often than Discord's rate limits allow. Tool calls show
  as a short status line. A reply longer than Discord's limit is split at paragraph boundaries.
- **Attachments.** Files and images on a message are downloaded with size and time limits and placed
  in the sandbox workspace. The message tells the model where they are.
- **Commands.** Slash commands: `/status` (model, running task, usage), `/abort`, `/reset` with an
  optional handoff note, and `/compact`.
- **Restart.** On start, the adapter rereads the messages it has not answered in each allowed
  channel since its last stored position and submits them with their message ids. On stop, it lets
  running work reach a checkpoint first.

## Execution environment

Each conversation's environment is a `pi-env` `RemoteExecutionEnv` connected over SSH to the
OpenShell sandbox. The built-in `read`, `write`, `edit`, and `bash` tools then run in the sandbox.
`pi-env` states that its results match local execution there, except for error messages.

Network rules in the sandbox start with GitHub, Hugging Face, npm, and PyPI, and grow through
OpenShell's draft-rule approvals. The sandbox never reaches the model providers or Discord, because
the worker makes those calls.

Phase 1 runs with a local environment so the adapter can be built and tested first. The sandbox
replaces it in phase 3, before the agent is used for real work.

## Instructions, skills, and extensions

- **Instructions.** One `AGENTS.md` in the sandbox workspace, rendered as a prompt section.
- **Skills.** Pi Durable has no built-in skills. Its specification shows the pattern instead: a
  `skills` extension whose prompt section lists each skill's name and description, read from the
  environment, with the full `SKILL.md` loaded through `read` when needed. The environment's `watch`
  reloads the list when skills change.
- **Extensions.** Each capability the agent needs beyond the built-in tools is a Durable extension
  in `packages/agent-worker`.
- **Anti-Repeat.** `pi-anti-repeat/core` has no Pi dependency, so the worker feeds it the
  `thinking_delta` events from `watchEvents` and the finished runs. A detection aborts the
  conversation and submits one corrective follow-up, with the same policy as the Pi extension.

## Approvals

A `beforeTool` hook decides which calls need approval, for example commands that push, delete, or
publish. A held call shows in Discord as a card with approve and reject buttons, and only Onur can
answer it. The call continues on approve and gets an error result on reject.

Approvals through unYOLO come next. unYOLO already sends approval requests to Onur's phone for its
brokers. A Pi Durable approval integration belongs in the unYOLO repository, so that one approval
channel covers both the brokers and the agent's tools.

## Scheduling

The host scheduler keeps its schedules and its run records. For each job it sends the prompt to the
worker's submit socket, a Unix socket owned by the worker user and writable only by the scheduler's
group. The submission's `requestId` is the job id plus the scheduled time, so a retried run never
submits twice. The worker posts the job's answer to the job's Discord channel.

## Credentials

- Model keys and the Discord token: in the worker user's configuration, used only by the worker.
- GitHub and Hugging Face: through the unYOLO brokers. OpenShell blocks loopback addresses inside
  the sandbox, so tools that need a broker run in the worker, not in the sandbox. Git transport from
  the sandbox needs its own answer (see the open questions).
- Nothing secret is placed in the sandbox environment or its workspace.

## Phases

1. **Worker and Discord, local environment.** The worker, SQLite storage, the Discord adapter, owner
   access, slash commands, and restart handling. Verify: a message is answered once; killing the
   worker in the middle of a tool call and starting it again finishes the run without a second
   answer; a message from another user starts nothing.
2. **Scheduler.** The submit socket and the scheduler's jobs. Verify: a job runs once per scheduled
   time, also when the scheduler retries.
3. **Sandbox.** `pi-env` into an OpenShell sandbox. Verify: `bash` runs in the sandbox; the sandbox
   cannot read the worker's files, the model keys, or the Discord token; a blocked domain is
   refused; the agent cannot run `sudo` or Docker.
4. **Approvals.** Discord approval cards, then the unYOLO integration. Verify: a held call waits for
   an answer, also across a worker restart. It runs on approve and fails on reject.
5. **Rollout.** Add the agent's instructions, skills, and scheduled jobs. Verify: a week of daily
   use and scheduled jobs runs without a lost or repeated answer.

## Open questions

- **SSH into the sandbox.** `pi-env` reaches its environment over SSH. Whether an OpenShell sandbox
  accepts an SSH connection for this, and how, needs a test before phase 3. If it does not, the
  fallback is a locked-down local user that runs the `pi-env` daemon.
- **Git push from the sandbox.** Either the worker holds a narrow GitHub credential and runs push as
  a worker-side tool, or OpenShell holds it as a provider bound to GitHub's paths.
- **Worker user.** Which user runs the worker, and who can restart it, is set up by Onur from his
  own shell, not by an agent.
- **Replies.** One edited message per run, or separate messages for long runs: decide after using
  phase 1.

## Not in scope

- Telegram and other chat services.
- Several people sharing the agent.
- Publishing either package to npm.
