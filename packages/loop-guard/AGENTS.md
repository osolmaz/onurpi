# @onurpi/loop-guard

- Keep the extension disabled until the user explicitly enables it.
- Use only documented Pi extension APIs. Do not patch Pi or inspect provider payloads.
- Keep collection event-driven and deterministic. Bound all work and retain it only in memory.
- Never call another model, access the network, or rescan the session transcript for detection.
- Send at most one automatic corrective message per epoch. Trip instead of sending another.
- Do not persist detector state or raw model and tool content.
- Add or update tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Then run `git diff --check`.
- Keep mutation testing manual unless the user explicitly requests it.
