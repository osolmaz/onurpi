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
    "guilds": { "<server id>": { "channels": { "<channel id>": {} } } }
  }
}
```

The agent's tools work in the `workspace` folder, and the agent reads its instructions from
`AGENTS.md` there. Relative paths are resolved against the folder of `config.json`. The SQLite file
is `agent.sqlite` in the workspace unless `storage` names another file.

The model `provider` is `echo`, `anthropic`, `huggingface`, `openai`, `openai-codex`, or
`openrouter`, and `modelId` names the model. The `echo` model answers `Echo: <message>` and needs no
key. `openai-codex` uses a ChatGPT subscription through the codex-switcher provider: it reads the
logins that codex-switcher keeps in the Pi agent folder, in place and with the same lock as Pi. The
folder is `~/.pi/agent` unless `model.agentDir` names another one. For the other hosted providers,
Pi AI reads the key from its usual environment variable, such as `ANTHROPIC_API_KEY` or `HF_TOKEN`.

The `discord` part says who the agent answers and where, as the
[discord-adapter README](../discord-adapter/README.md) describes. Its `tokenEnv` names the
environment variable that holds the bot token, which is `DISCORD_BOT_TOKEN` by default. The token
never goes in this file. Set `messageContent` to `true` when a channel answers without a mention.
The worker refuses to start without it, because Discord would not send the bot the text.

## Run it

From the repository root, after `npm install`:

```bash
node --import jiti/register packages/agent-worker/src/cli.ts run --config /path/to/config.json
```

`jiti` is the loader that Pi uses for extensions. The worker needs it because codex-switcher's
dependencies import `.ts` files by `.js` paths. The bot token must be in the environment variable
that `tokenEnv` names. The worker prints one JSON line per event and stops cleanly on Ctrl-C after
running answers finish.

## Mount its folders in OpenShell

The agent is meant to run inside an OpenShell sandbox, with its workspace mounted read-write at
`/sandbox/workspace` and its configuration mounted read-only at `/sandbox/config`. The `mounts`
command prints the value for `openshell sandbox create --driver-config-json`. Each folder is a host
folder or a named volume:

```bash
node --import jiti/register packages/agent-worker/src/cli.ts mounts --runtime docker \
  --workspace host:/srv/agent/workspace --config host:/srv/agent/config
node --import jiti/register packages/agent-worker/src/cli.ts mounts --runtime podman \
  --workspace volume:agent-workspace --config volume:agent-config
```

Host folders work only when the gateway has `enable_bind_mounts = true` and
`allow_driver_config = true`. Named volumes work with the default gateway settings.
