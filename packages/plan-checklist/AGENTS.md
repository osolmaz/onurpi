# @onurpi/plan-checklist

- Use only documented Pi extension hooks and exported public APIs.
- Keep the latest successful `update_plan` tool-result details on the active branch as the durable
  source of truth.
- Do not append custom entries or messages, write sidecar state, or modify Pi internals.
- Keep schema validation, branch replay, context continuity, and rendering in separate modules.
- Preserve full-snapshot replacement semantics and allow at most one `in_progress` step.
- Keep TUI rendering width-bounded, cached, and guarded by `ctx.mode === "tui"`.
- Add tests for every behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
