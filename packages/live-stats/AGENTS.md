# @onurpi/live-stats

- Keep token estimation and rolling-rate calculations separate from Pi event wiring.
- Mark live token counts as estimates until provider-reported output usage is available.
- Start timers from session lifecycle hooks and stop them during agent and session teardown.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
