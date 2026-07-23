# @onurpi/codex-usage

Show ChatGPT Codex subscription usage in Pi when requested, without adding a persistent footer or
statusline item.

## Usage

```text
/codex-status
/codex-status --refresh
/codex-status --timeout 30
```

The command reports the current rate-limit windows, reset times, and available full-reset credits.
Results are cached in memory for five minutes. Use `--refresh` to bypass the cache.

The extension first queries the fixed Codex usage endpoint with Pi's `openai-codex` subscription
authentication. If Pi authentication is unavailable, it temporarily launches `codex app-server` as a
fallback and stops it when the query finishes or times out.

Unlike upstream `@narumitw/pi-codex-usage`, this package never calls `ctx.ui.setStatus()`, does not
register model or session lifecycle hooks, and does not publish automatic usage text such as
`codex 0% wk`.

## State and boundaries

- Session state: unchanged. The extension writes no session entries or messages.
- Persistent data: none. The five-minute cache exists only in memory.
- Pi internals: none.
- Public API: `pi.registerCommand()`, `ctx.ui.notify()`, and `ctx.modelRegistry` authentication
  methods.

See [UPSTREAM.md](UPSTREAM.md) for provenance and the security review.

## License

[MIT](LICENSE)
