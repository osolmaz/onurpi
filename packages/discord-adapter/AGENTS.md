# @onurpi/discord-adapter

- Answer only the owners named in the configuration. Ignore every other user and bot, and never
  answer the bot's own messages.
- Keep the package free of Pi imports. The agent is reached only through the `AgentPort` interface.
- Use the Discord message id as the request id, so a message that arrives twice gets one answer.
- Send replies with mentions turned off. Do not ping users, roles, or `@everyone`.
- Do not request the Message Content intent unless the configuration asks for it.
- Never print, log, or store the bot token.
- Keep the discord.js code in `src/discordjs.ts`. Test everything else with the fake transport.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
