# @onurpi/bash-timeout-policy

- Use only the documented mutable `tool_call` hook and exported Pi type guards.
- Keep execution delegated to Pi's built-in bash tool.
- Preserve invalid explicit values so Pi's built-in validation remains authoritative.
- Keep the policy stateless and free of persistent configuration.
- Add tests for every timeout-policy behavior change.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and
  manual.
