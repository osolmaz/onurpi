# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.4.0`
- Source commit: `1729b5188d93d182ba3970af0aa1ac3a42615e11`
- Package source: exact npm release `0.4.0`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned extension

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.4.0` identifies built-in workflows by stable catalog IDs and revisions. It
migrates legacy path-based runs, including runs from old installations, before it resumes them. It
also rejects invalid timeout values at the configuration boundary. Workflow runs and controller
state are stored under Pi's user data directory as documented upstream. The wrapper adds no state or
runtime behavior.
