# @onurpi/codex-usage

Show ChatGPT Codex subscription usage in Pi. The extension provides the full `/codex-status` report
and publishes a compact weekly-remaining value only while an `openai-codex` model is active.

With Nyan Mode loaded, the compact value appears after the API cost and `(sub)` marker:

```text
34%/272k $0.000 (sub) 59% wk think high gpt5.4
```

The status is cleared as soon as Pi switches to another provider. Automatic refreshes run at session
startup, after model selection, and after settled Codex turns. A shared five-minute cache prevents
repeated network requests, and concurrent refreshes share one request. Automatic failures clear the
value quietly.

## Command

```text
/codex-status
/codex-status --refresh
/codex-status --timeout 30
```

The command reports current rate-limit windows, reset times, and available full-reset credits. Use
`--refresh` to bypass the cache. A successful explicit refresh also updates the compact weekly value
when a Codex model is active. Command failures keep their detailed notification.

The extension first queries the fixed Codex usage endpoint with Pi's `openai-codex` subscription
authentication. If Pi authentication is unavailable, it temporarily launches `codex app-server` as a
fallback and stops it when the query finishes or times out.

## State and boundaries

Normal Pi session state is unchanged because the extension writes no entries or messages. Usage data
exists only in process memory, and the implementation does not access Pi internals. It uses
documented lifecycle hooks. Status and notifications go through `ctx.ui.setStatus()` and
`ctx.ui.notify()`, while authentication uses `ctx.modelRegistry`.

The automatic path uses no timers or persistent background resources. See [UPSTREAM.md](UPSTREAM.md)
for provenance and the security review.

## License

[MIT](LICENSE)
