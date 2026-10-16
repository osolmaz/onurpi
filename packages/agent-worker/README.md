# agent-worker

agent-worker is a personal coding agent built on Pi Durable that its owner talks to in Discord. It
keeps every conversation in one SQLite file, so after a restart it continues unfinished work, and a
Discord message that arrives twice is answered once.

The package is private and is not a Pi extension.

## Configure it

Make a folder for the agent's work and write a `config.json`:

```json
{
  "workspace": "workspace",
  "model": { "provider": "echo" },
  "discord": {
    "ownerIds": ["<your Discord user id>"],
    "channelIds": ["<a channel id>"]
  }
}
```

- `workspace`: the folder the agent's tools work in. The agent reads its instructions from
  `AGENTS.md` in this folder. Relative paths are resolved against the folder of `config.json`.
- `storage`: the SQLite file. The default is `agent.sqlite` in the workspace.
- `model`: `provider` is one of `echo`, `anthropic`, `huggingface`, `openai`, `openai-codex`, or
  `openrouter`, and `modelId` names the model. The `echo` model answers `Echo: <message>` and needs
  no key. Pi AI reads the key for a hosted provider from its usual environment variable, for example
  `ANTHROPIC_API_KEY` or `HF_TOKEN`.
- `discord`: who and where the agent answers. See the
  [discord-adapter README](../discord-adapter/README.md). `tokenEnv` names the environment variable
  that holds the bot token, `DISCORD_BOT_TOKEN` by default. The token never goes in this file.

## Run it

From the repository root, after `npm install`:

```bash
node packages/agent-worker/src/cli.ts run --config /path/to/config.json
```

The bot token must be in the environment variable that `tokenEnv` names. The worker prints one JSON
line per event and stops cleanly on Ctrl-C after running answers finish.

## Mount its folders in OpenShell

The agent is meant to run inside an OpenShell sandbox, with its workspace mounted read-write at
`/sandbox/workspace` and its configuration mounted read-only at `/sandbox/config`. The `mounts`
command prints the value for `openshell sandbox create --driver-config-json`. Each folder is a host
folder or a named volume:

```bash
node packages/agent-worker/src/cli.ts mounts --runtime docker \
  --workspace host:/srv/agent/workspace --config host:/srv/agent/config
node packages/agent-worker/src/cli.ts mounts --runtime podman \
  --workspace volume:agent-workspace --config volume:agent-config
```

Host folders work only when the gateway has `enable_bind_mounts = true` and
`allow_driver_config = true`. Named volumes work with the default gateway settings.
