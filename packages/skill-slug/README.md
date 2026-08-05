# Skill Slug

Skill Slug invokes a Pi skill when you type its bare slug and press enter. Typing `amk` is
equivalent to typing `/skill:amk`.

The extension rewrites the input at Pi's `input` event, which runs before skill expansion, and
lets Pi expand the resulting `/skill:` command itself. The expansion is therefore identical to the
manually typed slash form for global, project, and package skills alike.

## Behavior

- The whole trimmed input must equal the slug exactly. `amk` rewrites; `amk please rewrite this`
  does not. Arguments remain available as `/skill:amk <args>`, which keeps natural-language
  messages that merely start with a slug from being hijacked.
- Attached images are preserved on the rewritten input.
- Skill names are cached from Pi's own loaded-skills list on each agent run. The very first
  message of a fresh session cannot match yet and passes through unchanged; the model still sees
  the skill in its system prompt.

The extension adds no session entries, settings, or persistent state.

## Install

From the OnurPi repository root, install the local package and restart Pi:

```bash
pi install ./packages/skill-slug
```
