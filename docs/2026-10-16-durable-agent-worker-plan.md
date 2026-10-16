---
title: A personal agent on Pi Durable in OpenShell, reached through Discord
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-10-16
tags: [pi, durable, discord, openshell, sandbox, agents]
---

# A personal agent on Pi Durable in OpenShell, reached through Discord

## Purpose

This plan describes a personal agent built on Pi Durable (`@earendil-works/pi-durable`). Its owner
talks to it through Discord. The whole agent runs inside an NVIDIA OpenShell sandbox, from the
Durable worker and its storage to the Discord adapter and the tools.

An agent that runs directly on a host, as a user who can become root, can read every secret on that
host. Running the agent in a sandbox removes that path. OpenShell runs the agent as a non-root user
with no Linux capabilities, under Landlock and seccomp limits. Every network connection goes through
a proxy that denies anything no rule allows. OpenShell also stores the agent's credentials and gives
the agent only placeholder values, which the proxy replaces in the requests it allows.

This document is the canonical plan for the agent worker and its Discord adapter.

## End state

- One worker process runs the agent on Pi Durable, with SQLite storage, inside an OpenShell sandbox.
  A crash or restart continues unfinished work, and a Discord message is never answered twice.
- The owner talks to the agent in Discord, in direct messages and in the channels the configuration
  allows. Nobody else can start a turn.
- Every credential the agent uses is an OpenShell provider. The agent sees only placeholder values
  and cannot read the real ones.
- The sandbox reaches only the hosts its network rules allow.
- No agent runs directly on the host. The OpenShell gateway runs as a host user that runs no agent.
- Scheduled jobs reach the agent from a scheduler on the host, which only delivers prompts and never
  runs an agent itself.
- The agent's storage is backed up to the host regularly.

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
`onYield`, and `afterTools`. Tools reach files and processes through an `ExecutionEnv`. Here it is
`NodeExecutionEnv`, so the built-in `read`, `write`, `edit`, and `bash` tools act inside the
sandbox.

## Layout

```text
host
├── OpenShell gateway (stores providers and policy)
├── scheduler (delivers job prompts)
└── OpenShell sandbox
    ├── agent worker: Pi Durable, SQLite storage, Discord adapter
    └── workspace: AGENTS.md, skills, repositories, attachments
            │
            └── proxy ──► Discord, model providers, GitHub, package registries
```

The sandbox image contains Node.js and the worker. It holds no secrets. The gateway gives each
provider to the sandbox as a placeholder value in its environment, and the proxy puts the real value
into requests to the hosts and paths that the provider is bound to.

## Packages

Both packages live in OnurPi for now, under `packages/`, and are not Pi CLI extensions: they stay
out of the root Pi manifest and the settings sync. Both stay private, and neither is published to
npm without a separate decision. Personal configuration never goes into OnurPi. The agent's
instructions and Discord ids live in the owner's private configuration, and the tokens live in
OpenShell providers.

- `packages/discord-adapter`: connects Discord to Pi Durable conversations. It depends on Pi Durable
  and discord.js, and on nothing else in OnurPi, so it can move to its own repository later.
- `packages/agent-worker`: the program and its sandbox image. It opens the Durable harness with its
  extensions and starts the Discord adapter and the scheduler inbox. It also handles restarts. It
  also holds the OpenShell network policy that the sandbox runs with.

Pi Durable and Chord are pinned to exact versions, because their APIs change between releases.

## Discord adapter

Two existing projects serve as references for designs, not as code to copy. `pi-roundtable` is the
most actively maintained Discord host for Pi. Its approval cards and slash commands are useful
models. So are the way it reads the messages around an addressed message, its attachment downloads
with deadlines, and how it finishes running work before a stop. `@llblab/pi-telegram` is the best
maintained chat adapter for Pi, and shows how a chat maps onto a Pi session.

Behaviour:

- **Access.** Only the owner's Discord user can start a turn or answer a card. The adapter ignores
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
- **Attachments.** Files and images on a message are downloaded with size and time limits into the
  workspace. The message tells the model where they are.
- **Commands.** Slash commands: `/status` (model, running task, usage), `/abort`, `/reset` with an
  optional handoff note, and `/compact`.
- **Restart.** On start, the adapter rereads the messages it has not answered in each allowed
  channel since its last stored position and submits them with their message ids. On stop, it lets
  running work reach a checkpoint first.

## Instructions, skills, and extensions

- **Instructions.** One `AGENTS.md` in the workspace, rendered as a prompt section.
- **Skills.** Pi Durable has no built-in skills. Its specification shows the pattern instead: a
  `skills` extension whose prompt section lists each skill's name and description, read from the
  workspace, with the full `SKILL.md` loaded through `read` when needed. The environment's `watch`
  reloads the list when skills change.
- **Extensions.** Each capability the agent needs beyond the built-in tools is a Durable extension
  in `packages/agent-worker`.
- **Anti-Repeat.** `pi-anti-repeat/core` has no Pi dependency, so the worker feeds it the
  `thinking_delta` events from `watchEvents` and the finished runs. A detection aborts the
  conversation and submits one corrective follow-up, with the same policy as the Pi extension.

## Limits and approvals

The worker and the model's `bash` run in the same sandbox, so the agent can read and change its own
code and storage. Anything that must hold against the agent is therefore enforced outside the
sandbox:

- **Network.** OpenShell's rules decide which hosts and paths the sandbox reaches. A blocked request
  becomes a draft rule that the owner approves or rejects from the host.
- **Credentials.** Each provider is bound to the hosts and paths it may be used for. The GitHub
  token is a narrow token without repository administration, bound to the API paths and Git
  operations the agent needs.

Inside the worker, a `beforeTool` hook can hold calls such as pushes, deletes, and publishes until
the owner answers a Discord card with approve or reject. This is a convenience that stops honest
mistakes. It is not a security limit, because the agent can change the worker that runs it.

## Scheduling

The scheduler on the host keeps its schedules and its run records. For each job it delivers the
prompt into the sandbox as a file in an inbox directory of the workspace, using OpenShell's upload
command. The file name is the job id plus the scheduled time. The worker watches the inbox and
submits each new file with that name as its `requestId`, so a retried delivery never runs a job
twice. The worker posts the job's answer to the job's Discord channel.

## Storage and backups

The SQLite file lives in the sandbox workspace. Durable runs it in WAL mode, so a commit survives a
process crash, but the newest commit can be lost on a power failure. Only the worker opens it,
because Durable has no locking between processes.

A backup job on the host makes a consistent copy with SQLite's backup command inside the sandbox,
then downloads it with OpenShell's download command. Backups keep a rolling history on the host.

## Phases

1. **Worker and Discord, outside a sandbox, for development only.** The worker with its storage and
   the Discord adapter, run with a test bot and no real credentials. Verify: a message is answered
   once; killing the worker in the middle of a tool call and starting it again finishes the run
   without a second answer; a message from another user starts nothing.
2. **Inside OpenShell.** The sandbox image, the providers, and the network policy. Verify that the
   agent answers in Discord from inside the sandbox while its environment holds only placeholder
   values. A request to a host without a rule must be refused, and `sudo` and Docker must be
   unavailable. The storage and the workspace must survive a sandbox restart and a rebuild.
3. **Scheduler and backups.** The inbox and the backup job. Verify: a job runs once per scheduled
   time, also when delivery is retried; a backup restores into a fresh sandbox.
4. **Approvals and GitHub.** Discord approval cards and the narrow GitHub provider. Verify that a
   held call waits for an answer, also across a worker restart, and runs only on approve. The GitHub
   token must not reach paths outside its binding.
5. **Rollout.** Add the agent's instructions, skills, and scheduled jobs. Verify: a week of daily
   use and scheduled jobs runs without a lost or repeated answer.

## Open questions

- **Workspace persistence.** OpenShell's docs say custom workspaces on the Docker and Podman
  runtimes use the container's writable layer, not a managed volume. Phase 2 must show that the
  SQLite file survives a restart and a rebuild, or the storage must move to a location that does.
- **Discord through the proxy.** The Discord gateway sends the bot token inside a WebSocket message,
  and OpenShell replaces placeholders in WebSocket text only when that is turned on. The proxy also
  terminates TLS with a sandbox certificate authority that Node.js must trust. Phase 2 tests both.
- **Gateway user and runtime.** The gateway's runtime decides what its host user needs. Docker
  access is equal to root, so that user must run no agent. Rootless Podman 5 or the MicroVM runtime
  avoid that. The owner sets this up, not an agent.
- **Upload and download commands.** The exact OpenShell commands, and their limits, for the inbox
  and the backups need checking against the installed version.
- **Replies.** One edited message per run, or separate messages for long runs: decide after using
  phase 1.

## Not in scope

- Telegram and other chat services.
- Several people sharing the agent.
- Publishing either package to npm.
