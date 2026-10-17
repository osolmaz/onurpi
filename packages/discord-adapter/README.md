# discord-adapter

discord-adapter is a Discord bot bridge for a personal agent. It gives each message from the agent's
owner to the agent and posts the answer in the same channel or thread.

The package is private. It does not import Pi. Any agent that implements the `AgentPort` interface
can use it.

## What it answers

- Only users whose ids are in `ownerIds`. Other users and other bots are ignored.
- Only the server channels listed under `guilds`. A thread follows its parent channel. A new channel
  gets no answer until you add it.
- In a listed channel, only messages that mention the bot, unless `requireMention` is `false` for
  the channel or for its server. The channel's own value wins.
- Direct messages from an owner, unless `directMessages` is `false`.

```json
{
  "ownerIds": ["<your Discord user id>"],
  "guilds": {
    "<server id>": {
      "requireMention": false,
      "channels": {
        "<channel id>": {},
        "<another channel id>": { "requireMention": true },
        "<a paused channel id>": { "enabled": false }
      }
    }
  }
}
```

A channel stays in the list with `"enabled": false` when you want to pause it.

Each channel or thread is its own conversation. The Discord message id is the request id, so a
message seen twice is answered once.

## Use it

```ts
import { connectDiscord, DiscordBridge, parseAdapterConfig } from "@onurpi/discord-adapter";

const config = parseAdapterConfig({ ownerIds: ["<your Discord user id>"] });
const transport = await connectDiscord({
  token: process.env.DISCORD_BOT_TOKEN ?? "",
  messageContent: false,
});
const bridge = new DiscordBridge(transport, agent, config, (event, details) =>
  console.log(event, details),
);
bridge.start();
```

While the agent works, Discord shows that the bot is typing. The bridge sends the typing indicator
again every 8 seconds, because Discord clears it after about 10 seconds. The answer is a reply to
the message, and an answer longer than 2000 characters goes on in more messages.

## Discord setup

The bot needs the View Channel, Send Messages, Send Messages in Threads, and Read Message History
permissions in each channel it answers.

Without the Message Content intent, Discord sends the bot the text of a message only when the
message mentions the bot or is a direct message. Keep `requireMention` on in that case. To answer
messages without a mention, turn on the Message Content intent in the Discord Developer Portal and
pass `messageContent: true`. `answersWithoutMention(config)` tells you whether a configuration needs
it.
