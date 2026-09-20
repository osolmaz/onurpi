# @onurpi/live-stats

- Keep token estimation and rolling-rate calculations separate from Pi event wiring.
- Mark live token counts as estimates until provider-reported output usage is available.
- Start timers from session lifecycle hooks and stop them during agent and session teardown.
- Keep the braille animation set in `spinners.ts`, and pick one spinner per session instead of per
  render.
- Run `npm run viewer` after a change to the spinner set. A test fails when the committed
  `viewer.html` and the spinner set disagree.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
