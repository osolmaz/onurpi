# @onurpi/agent-worker

- Pin Pi Durable, Pi AI, and Chord to exact versions. Their APIs change between releases. Keep them
  on the Pi release that the rest of OnurPi uses.
- Commit every answer before it is returned. Never post a reply from state that is not stored.
- Keep the worker the only process that opens the SQLite file.
- Read tokens and keys only from environment variables. Never write them to the configuration, the
  workspace, logs, or errors.
- Keep personal configuration, such as Discord ids and the agent's `AGENTS.md`, out of this
  repository. Tests use made-up ids.
- Use the `echo` model in tests. Tests must not reach the network.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
