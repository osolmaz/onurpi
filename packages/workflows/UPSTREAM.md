# Upstream record

- Repository: https://github.com/osolmaz/pi-workflows
- Latest release at review: `v0.7.0`
- Source commit: `2889614e293458cab6a24ed03cdc35c6d867f96e`
- Package source: exact npm release `0.7.0`
- License: MIT
- Local changes: `index.ts` re-exports the pinned extension and the package manifest exposes the
  upstream skills

The reviewed source provides workflow and controller commands, model-managed workflow controls, the
built-in monitor workflow, durable controller state, child workflow scheduling, and the standalone
workflow host. Release `0.7.0` bundles the upstream `pi-workflows` and `monitor` skills with the
extension. Pi package filters can disable one skill, all skills, or the extension independently. The
release keeps the existing durable workflow updates, optional multi-track progress, measured and
source ETAs, compact workflow step cards, and report-every-check monitor behavior. It also requires
explicit approval before the monitor launches, resumes, retries, or replaces paid work. Workflow
runs and controller state stay under Pi's user data directory as documented upstream. The wrapper
adds no state or runtime behavior.
