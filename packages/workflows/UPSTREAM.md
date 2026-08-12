# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.3.0`
- Source commit: `828a30e2a62ef59862a86c2f7cd73376803d7a7b`
- Package source: immutable GitHub archive for that commit
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. This post-release commit coordinates workflow agent timeouts with Pi turn
cancellation, keeps user-held turns separate, adds configurable monitor check timeouts, and does not
present failed runs as successful results. Workflow runs and controller state are stored under Pi's
user data directory as documented upstream. The wrapper adds no state or runtime behavior.
