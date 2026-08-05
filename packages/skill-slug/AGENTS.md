# @onurpi/skill-slug

- Keep the slug decision pure and separate from Pi event wiring.
- Match whole trimmed input only; never match a leading word of a longer message.
- Let Pi expand the rewritten `/skill:` command itself; do not re-implement skill loading.
- Add no session entries, persistence, or Pi internals.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
