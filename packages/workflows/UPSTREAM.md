# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.5.3`
- Source commit: `5e148e71a2c470e0acf0aee7d2e53c7f99126b75`
- Package source: exact npm release `0.5.3`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.5.3` uses Pi's current theme in the compact widget. The full active row
uses the accent color and a bold node name. Waiting, completed, and failed states use their matching
theme colors, while glyphs keep each state clear without color. Pending and secondary details stay
dim. RPC mode still receives plain serializable strings with no terminal escape codes. Workflow runs
and controller state are stored under Pi's user data directory as documented upstream. The wrapper
adds no state or runtime behavior.
