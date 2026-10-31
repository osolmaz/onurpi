# agent-worker

agent-worker is a personal coding agent built on Pi Durable that its owner talks to in Discord.
Every conversation lives in one SQLite file. After a restart the worker continues unfinished work
and answers the messages that came in meanwhile, and a message that arrives twice gets one answer.

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

The agent's tools work in the `workspace` folder. Relative paths are resolved against the folder of
`config.json`. The SQLite file is `agent.sqlite` in the workspace unless `storage` names another
file.

The agent loads its instructions as Pi does: the `AGENTS.md` in the Pi agent folder first, then one
`AGENTS.md` or `CLAUDE.md` per folder from the root down to the workspace. The Pi agent folder is
`~/.pi/agent` unless `agentDir` names another one. The files are read again for every answer.

The model `provider` is `echo`, `anthropic`, `huggingface`, `openai`, `openai-codex`, `opencode-go`,
or `openrouter`, and `modelId` names the model. The `echo` model answers `Echo: <message>` and needs
no key. `openai-codex` uses the ChatGPT subscription of the `chatgpt-codex` OpenShell provider
attached to the sandbox, so it runs only inside the sandbox. For the other hosted providers, Pi AI
reads the key from its usual environment variable, such as `ANTHROPIC_API_KEY`, `HF_TOKEN`, or
`OPENCODE_API_KEY`.

`compaction` bounds the transcript. Pi Durable summarizes an old prefix of the context when a
request would cross a threshold, keeping the recent part verbatim. `contextCeiling` is the largest
request the agent may send: it caps the model's context window, so the thresholds follow from it.
The other fields are `enabled`, `reserveTokens` (room kept for the answer, 16384 by default),
`keepRecentTokens` (the recent context a summary keeps, 20000 by default), and `backgroundTokens`
(how far below the blocking threshold a background compaction starts, 32768 by default).

```json
"compaction": { "contextCeiling": 272000 }
```

Owners can also send `/compact [note]` to summarize on demand, with an optional note that steers the
summary.

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

`jiti` is the loader that Pi uses for extensions. The worker needs it because the workspace packages
use TypeScript syntax, such as constructor parameter properties, that Node's type stripping does not
run. The bot token must be in the environment variable that `tokenEnv` names. The worker prints one
JSON line per event and stops cleanly on Ctrl-C after running answers finish.

## Scheduled prompts

With an `inbox` in the configuration, the worker answers prompts that a scheduler drops into a
folder and posts each answer to the prompt's Discord channel:

```json
"inbox": { "folder": "inbox", "channelIds": ["<a channel id>"] }
```

The scheduler delivers a prompt with:

```bash
node --import jiti/register packages/agent-worker/src/cli.ts deliver \
  --inbox /path/to/inbox --channel "<a channel id>" --prompt "Write today's digest."
```

The file name is the job id and the scheduled time. Under onurcron they come from `ONURCRON_JOB_ID`
and `ONURCRON_SCHEDULED_FOR`; `--job` and `--scheduled-for` set them by hand. A second delivery of
the same scheduled time writes nothing, and each delivery is answered once.

## Approvals

Some `bash` commands wait for the owner: `git push`, `gh pr merge`, `gh release create`,
`gh repo delete`, `npm publish`, and `rm -rf`. The worker blocks the call and posts a card in the
chat with a request number. The owner replies `approve <n>` or `reject <n>`; after an approval the
agent runs exactly the same call once. Requests and decisions are stored, so they survive a restart.
`approvals.held` replaces the list of patterns, and `approvals.channelId` names where cards for
scheduled jobs go. This stops honest mistakes; it is not a security limit.

## Mount its folders in OpenShell

The agent is meant to run inside an OpenShell sandbox, with its workspace mounted read-write at
`/sandbox/work` and its configuration mounted read-only at `/sandbox/config`. The `mounts` command
prints the value for `openshell sandbox create --driver-config-json`. Each folder is a host folder
or a named volume:

```bash
node --import jiti/register packages/agent-worker/src/cli.ts mounts --runtime docker \
  --workspace host:/srv/agent/workspace --config host:/srv/agent/config
node --import jiti/register packages/agent-worker/src/cli.ts mounts --runtime podman \
  --workspace volume:agent-workspace --config volume:agent-config
```

`--hide` keeps a workspace path out of the sandbox: a folder that ends in `/` gets an empty tmpfs
and a file gets `/dev/null`. Use it for a secrets folder that lives in the workspace.

The `openshell` folder holds the sandbox image (`build-image.sh` builds it from the committed tree),
the network policy, and four provider profiles: `discord-bot`, `chatgpt-codex`, whose access token
the gateway refreshes, `google-workspace`, a Google OAuth login for the image's `gws` CLI whose
access token the gateway also refreshes, and `opencode-go`.

The sandbox holds no GitHub token. `unyolo setup` connects it to the unYOLO GitHub broker: it
creates an `unyolo-github-<connection>` provider that holds the broker client secret and writes the
sandbox environment for stock `gh` and `git`. Create the sandbox with that provider and that
environment.

Host folders work only when the gateway has `enable_bind_mounts = true` and
`allow_driver_config = true`. Named volumes work with the default gateway settings.
