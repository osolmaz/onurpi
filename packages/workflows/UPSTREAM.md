# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Source commit: `b7cc2ab824beef324daa2785bdba89db6a85c9c6`
- Package source: immutable GitHub archive for that commit
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source adds the durable controller runtime, project-scoped SQLite stores, delayed
reconciliation queues, child workflow scheduling, and the standalone always-on workflow host. The
extension registers workflow and controller commands and tools. Workflow runs and controller state
are stored under Pi's user data directory as documented upstream. The wrapper adds no state or
runtime behavior.
