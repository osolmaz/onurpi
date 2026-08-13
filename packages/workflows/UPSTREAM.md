# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.5.1`
- Source commit: `f6c24280612b23843df4dd76de7c78312d18c48c`
- Package source: exact npm release `0.5.1`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.5.1` makes the live workflow widget responsive. It keeps the boxed graph
when it fits and uses a compact node list when the Pi terminal is narrow. Every line fits the width
that Pi supplies, active and waiting states remain visible, resize scroll state stays correct, and
RPC mode keeps serializable widget updates. Workflow runs and controller state are stored under Pi's
user data directory as documented upstream. The wrapper adds no state or runtime behavior.
