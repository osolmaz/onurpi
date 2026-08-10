# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Source commit: `21935920df857c1eb4e439682b14c67b22068778`
- Package source: immutable GitHub archive for that commit
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Workflow runs and controller state are stored under Pi's user data directory as
documented upstream. The wrapper adds no state or runtime behavior.
