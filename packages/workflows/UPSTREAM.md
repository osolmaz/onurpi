# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.5.0`
- Source commit: `c19c1bde597d5246914cf7f68298dfcb688122cc`
- Package source: exact npm release `0.5.0`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.5.0` addresses progress and final reports to the Pi session that started
the run. It adds a durable notification outbox and a `notify` workflow node, and it updates the
built-in monitor to use them. Delivery uses stable logical notification IDs and short claims, so
retries, restarts, two Pi processes, and standalone-host execution do not send the same report to
unrelated sessions. Workflow runs and controller state are stored under Pi's user data directory as
documented upstream. The wrapper adds no state or runtime behavior.
