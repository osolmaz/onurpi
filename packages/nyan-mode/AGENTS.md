# @onurpi/nyan-mode

- Preserve `UPSTREAM.md`, `NOTICE`, and both GPL license files when updating vendored code or artwork.
- Keep XPM parsing, PNG encoding, layout, and progress calculations separate from Pi event wiring and terminal painting.
- Do not add process execution, network access, telemetry, or persistent session records.
- Start animation timers only from session-owned painters and stop them during clear, dispose, and session teardown.
- Keep a usable footer when Kitty images are unsupported or terminal width is insufficient.
- Run `npm run check`, `npm run mutate`, and `npm run slophammer` before finishing.
