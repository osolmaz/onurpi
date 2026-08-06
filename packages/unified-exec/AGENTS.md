# AGENTS.md

Whenever you edit code, docs, tests, or package metadata, update `Changelog.md` in the same change.

Before changing long-wait/wake behavior, read `docs/IV-0001-long-wait-and-wake-control.md`. Before changing result bounds, logs, truncation, or TUI tool rendering, read `docs/IV-0002-output-lifecycle-and-rendering.md`.

Canonical verification:

```bash
npm test
```

If you want to inspect pi-mono's source code, git clone https://github.com/earendil-works/pi (formerly badlogic/pi-mono; old URL redirects) to ./local_data/pi-mono

./local_data is added in .gitignore.

## Frontier Models

The following are the frontier models. Prefer to use them as defaults:

- `gpt-5.5`
- `claude-opus-4-7`
