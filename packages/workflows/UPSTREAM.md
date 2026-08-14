# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.5.2`
- Source commit: `b840cee19552989cabaa29275e24bbcf015e537a`
- Package source: exact npm release `0.5.2`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.5.2` makes the compact one-line node list the default Pi widget at every
width. It adds terminal-safe node-type symbols, repeat counts, runtime details, timing, and bounded
errors while keeping the full graph in the standalone viewer. Every line fits the width that Pi
supplies, active and waiting states remain visible, and RPC mode keeps serializable widget updates.
Workflow runs and controller state are stored under Pi's user data directory as documented upstream.
The wrapper adds no state or runtime behavior.
