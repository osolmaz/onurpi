# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Release: `v0.3.0`
- Source commit: `be8c33c34f3917fa1266136f4ed57608f14ff5f8`
- Package source: immutable GitHub archive for that commit
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Workflow runs and controller state are stored under Pi's user data directory as
documented upstream. The wrapper adds no state or runtime behavior.
