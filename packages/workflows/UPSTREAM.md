# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.6.0`
- Source commit: `f6c6017a2e90f457ec6c1f12d5123d4ff7cbc22f`
- Package source: exact npm release `0.6.0`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.6.0` adds durable workflow updates, optional multi-track progress,
measured and source ETAs, compact workflow step cards, and a monitor that reports every check by
notification. The monitor defaults to a 30-minute interval and can infer its stop rule from the
request. Progress history, update size, update rate, and terminal rendering are bounded and
validated. Workflow runs and controller state stay under Pi's user data directory as documented
upstream. The wrapper adds no state or runtime behavior.
