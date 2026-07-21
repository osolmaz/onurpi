# @onurpi/reliable-compaction

- Use only documented Pi extension hooks and exported public APIs. Do not patch Pi internals or write session entries directly.
- Keep transport policy selection separate from Pi event wiring.
- Pass through providers without an explicit reliability policy.
- Never retry an aborted compaction or fall back to a transport the policy replaced.
- Run `npm run check` and `npm run slophammer` before finishing. Mutation testing is optional and manual.
