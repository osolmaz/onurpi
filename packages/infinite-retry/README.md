# Infinite Retry

Infinite Retry makes Pi retry transient model failures until they succeed or you cancel them.

It uses Pi's existing transient-error classifier and continuation path. The delay doubles after each
failure and stops growing at 10 minutes:

```text
2s, 4s, 8s, 16s, ... 8m 32s, 10m, 10m, ...
```

Press `Alt+R` or run `/retry-now` to skip the current wait. Press Escape to cancel the retry loop.
`/retry-status` reports the current attempt and remaining delay.

## Compatibility

This extension intentionally patches private methods in `AgentSession`. Pi 0.82.1 is the minimum
audited version, and Pi 0.83.0 uses the same retry contract. Newer Pi versions are accepted when the
required private methods retain their expected signatures and remain patchable. The extension fails
closed on older versions or a changed runtime shape instead of applying a partial patch.

The patch is installed when the extension loads and restored during reload, session replacement, or
shutdown. It does not add custom session entries, change the session schema, or send retry messages
to the model. Pi continues to record ordinary failed assistant responses as part of its existing
retry behavior.

Contract impact:

- **Session state:** only Pi's ordinary assistant error and retry entries; no extension entries.
- **Other persistent data:** none.
- **Pi internals:** two reversible private method wrappers; no Pi files are modified.
- **Public API:** `session_start`, `session_shutdown`, `registerShortcut`, `registerCommand`, and
  `ctx.ui.setStatus()`.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing is available through `npm run mutate`, but it is not part of normal validation.
