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

This extension intentionally patches private methods in `AgentSession`. It supports exactly Pi
0.82.1 and refuses to patch any other version. Review the patch before changing the supported Pi
version.

The patch is installed when the extension loads and restored during reload, session replacement, or
shutdown. It does not add custom session entries, change the session schema, or send retry messages
to the model. Pi continues to record ordinary failed assistant responses as part of its existing
retry behavior.

## Development

```bash
npm run check
npm run slophammer
```

Mutation testing is available through `npm run mutate`, but it is not part of normal validation.
