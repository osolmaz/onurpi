# discord-adapter

discord-adapter is a Discord bot bridge for a personal agent. It gives each message from the agent's
owner to the agent and posts the answer in the same channel or thread.

The package is private. It does not import Pi. Any agent that implements the `AgentPort` interface
can use it.

## What it answers

- Only users whose ids are in `ownerIds`. Other users and other bots are ignored.
- In server channels, only messages that mention the bot, unless `requireMention` is `false`.
- Only server channels in `channelIds`. A thread follows its parent channel. With an empty list, the
  bot answers no server channel, only direct messages.
- Direct messages from an owner, unless `directMessages` is `false`.

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

The bot first replies with "Working on it…", then replaces that message with the answer. Answers
longer than 2000 characters continue in more messages.

## Discord setup

The bot needs the View Channel, Send Messages, Send Messages in Threads, and Read Message History
permissions in each channel it answers.

Without the Message Content intent, Discord sends the bot the text of a message only when the
message mentions the bot or is a direct message. Keep `requireMention` on in that case. To answer
messages without a mention, turn on the Message Content intent in the Discord Developer Portal and
pass `messageContent: true`.
