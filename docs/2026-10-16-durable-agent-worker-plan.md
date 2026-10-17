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
- The agent's workspace and configuration are folders mounted into the sandbox, so they outlive any
  rebuild of the sandbox.

## Pi Durable in short

Pi Durable is a library, not a program, and is marked experimental: its API changes without notice
between releases. The worker pins version 1.2.0, the Pi release that the rest of OnurPi uses, so it
can use the codex-switcher provider. The `pi` CLI does not use it. The worker described here is the
program that uses it.

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
└── OpenShell sandbox    ├── agent worker: Pi Durable, Discord adapter
    ├── /sandbox/work (mounted, read-write): SQLite storage, AGENTS.md, skills, repositories
    └── /sandbox/config (mounted, read-only): worker settings
            │
            └── proxy ──► Discord, model providers, GitHub, package registries
```

The sandbox image contains Node.js and the worker. It holds no secrets, and neither do the mounted
folders. The gateway gives each provider to the sandbox as a placeholder value in its environment,
and the proxy puts the real value into requests to the hosts and paths that the provider is bound
to.

## Packages

Both packages live in OnurPi for now, under `packages/`, and are not Pi CLI extensions: they stay
out of the root Pi manifest and the settings sync. Both stay private, and neither is published to
npm without a separate decision. Personal configuration never goes into OnurPi. The agent's
instructions and Discord ids live in the owner's private configuration, and the tokens live in
OpenShell providers.

- `packages/discord-adapter`: connects Discord to the agent's conversations. It depends only on
  discord.js. It reaches the agent through a small `AgentPort` interface, which the worker
  implements with Pi Durable, so the adapter has no Pi dependency, its tests need no storage, and it
  can move to its own repository later.
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
  every other author, including other bots. Allowed channels are listed in the configuration per
  server, and a channel that is not listed gets no answer. Each server and each channel can turn the
  mention rule off, and the channel's own value wins.
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
prompt as a file in an inbox folder of the workspace, with `agent-worker deliver`. The workspace is
a host folder, so the scheduler writes the file directly; a named volume would need OpenShell's
upload command instead. The file name is the job id plus the scheduled time, which the scheduler
passes to command jobs as `ONURCRON_JOB_ID` and `ONURCRON_SCHEDULED_FOR`. The worker watches the
inbox and submits each new file with that name as its `requestId`, so a retried delivery never runs
a job twice. The worker posts the job's answer to the job's Discord channel, which must be one of
the inbox's configured channels.

## Storage

Two folders are mounted into the sandbox with OpenShell's driver configuration
(`--driver-config-json`), which the Docker and Podman runtimes support:

- **Workspace, read-write.** It holds the SQLite file and `AGENTS.md`, plus the skills,
  repositories, and attachments. The agent needs to write it.
- **Configuration, read-only.** It holds the worker's settings, such as the allowed Discord
  channels. The agent cannot change them. Secrets never go here; they are OpenShell providers.

The data lives in the mounted folders, so a sandbox rebuild keeps it and nothing has to be copied
out for the agent to work.

The worker's setup supports both kinds of mount, chosen per folder:

- **Host folder.** A normal folder on the host, which the owner can open and back up with ordinary
  tools. This is the owner's choice for this agent. OpenShell turns host folders off by default and
  warns that they "can bypass workspace isolation and filesystem policy", so the gateway needs
  `enable_bind_mounts = true`, `allow_driver_config = true`, and its resource admission turned off.
  Each mounted folder is used only by the agent and holds nothing else from the host.
- **Named volume.** Storage that Docker or Podman manages and that is referred to by name. It works
  with the gateway's default settings, but its files are reached only through the container runtime.

The SQLite file stays in a mounted folder because WAL mode keeps `-wal` and `-shm` files next to the
database. Only the worker opens the database, because Durable has no locking between processes.

Backups are optional. They protect against two things a mount does not: the agent breaking its own
data, which it can do because it writes the workspace, or the disk failing. A backup is a copy made
with SQLite's backup command, never a plain file copy while the worker runs.

## Phases

1. **Worker and Discord, outside a sandbox, for development only.** The worker with its storage and
   the Discord adapter, run with a test bot and no real credentials. Verify: a message is answered
   once; killing the worker in the middle of a tool call and starting it again finishes the run
   without a second answer; a message from another user starts nothing.
2. **Inside OpenShell.** The sandbox image, the providers, and the network policy. Verify that the
   agent answers in Discord from inside the sandbox while its environment holds only placeholder
   values. A request to a host without a rule must be refused, and `sudo` and Docker must be
   unavailable. The mounted workspace must survive a sandbox rebuild, and the agent must not be able
   to write the configuration folder.
3. **Scheduler.** The inbox. Verify: a job runs once per scheduled time, also when delivery is
   retried.
4. **Approvals and GitHub.** Discord approval cards and the narrow GitHub provider. Verify that a
   held call waits for an answer, also across a worker restart, and runs only on approve. The GitHub
   token must not reach paths outside its binding.
5. **Rollout.** Add the agent's instructions, skills, and scheduled jobs. Verify: a week of daily
   use and scheduled jobs runs without a lost or repeated answer.

## Status

Phases 1 to 4 have code in OnurPi; what was verified live is listed with each phase.

- **Phase 1.** The worker, the Discord adapter, Pi's instructions, the ChatGPT subscription through
  codex-switcher, per-channel access rules, and the reply ledger. A worker killed with SIGKILL
  during a `bash` call posted exactly one reply after a restart.
- **Phase 2.** The sandbox image, the network policy, and the `discord-bot` and `chatgpt-codex`
  provider profiles. Inside the sandbox, Codex reads placeholders through a JWT-shaped wrapper, and
  the gateway refreshes the access token. The workspace is mounted at `/sandbox/work`, because
  OpenShell reserves `/sandbox/workspace` and the image's working folder. A test sandbox with the
  owner's folders showed: uid 1001, both instruction files, hidden secrets, a writable workspace, a
  read-only configuration, no sudo or Docker, a refused outside host, and no host home folder. The
  gateway runs as the owner's user, not a separate user: that user already has sudo and Docker, so a
  separate user would protect nothing; the boundary is the sandbox. The agent now runs in the
  sandbox with its two providers. Its environment holds only placeholders, it answered in Discord,
  and the sandbox log shows Codex and Discord reached through the provider policies with nothing
  denied.
- **Phase 3.** The inbox and `agent-worker deliver`; onurcron passes `ONURCRON_JOB_ID` and
  `ONURCRON_SCHEDULED_FOR` to command jobs. Two deliveries of one scheduled time gave one answer in
  Discord.
- **Phase 4.** Approval cards for held `bash` commands, and the `agent-github` profile.

Not done yet: streaming edits, tool status lines, follow-ups and steers, thread forks, attachments,
slash commands, skills, and porting OnurPi extensions as Durable extensions.

## Open questions

- **Host folder permissions.** The sandbox runs as a non-root user, so the host folders must be
  writable by that user's id inside the container, and the configuration folder must stay read-only.
  Phase 2 sets the folders' owner and checks both.
- **Named volume lifetime.** The docs do not say whether a named volume is kept when its sandbox is
  deleted. Phase 2 tests that for the named-volume setup.
- **Discord through the proxy.** The Discord gateway sends the bot token inside a WebSocket message,
  and OpenShell replaces placeholders in WebSocket text only when that is turned on. The proxy also
  terminates TLS with a sandbox certificate authority that Node.js must trust. Phase 2 tests both.
- **Subscription login in the sandbox.** The `openai-codex` logins are OAuth tokens that the
  codex-switcher provider refreshes in its file on the host. Phase 2 decides how the sandbox gets
  them as an OpenShell provider without a copy of the refresh token.
- **Gateway user and runtime.** The gateway's runtime decides what its host user needs. Docker
  access is equal to root, so that user must run no agent. Rootless Podman 5 avoids that. The
  MicroVM runtime does not support mounts, so it does not fit this plan. The owner sets this up, not
  an agent.
- **Replies.** One edited message per run, or separate messages for long runs: decide after using
  phase 1.

## Not in scope

- Telegram and other chat services.
- Several people sharing the agent.
- Publishing either package to npm.
