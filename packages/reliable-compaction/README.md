# @onurpi/reliable-compaction

`@onurpi/reliable-compaction` makes Pi compaction use a stable transport when a provider's default
transport is unsuitable for long summaries.

For models using the `openai-codex-responses` API, the extension sends compaction summaries over SSE
instead of WebSocket. Pi still performs the compaction through its configured provider pipeline, so
base URL and authentication overrides, request headers, timeout settings, split-turn handling,
custom instructions, file tracking, thinking level, and automatic overflow recovery are preserved.

A failed summary request is retried once because Pi does not append the compaction entry until a
complete result exists. Cancellation is never retried. Both attempts stay on SSE, so failure does
not fall back to the replaced WebSocket transport.

Providers without a transport policy continue through Pi's default compaction behavior. The
extension also passes through providers whose stream handler is supplied by another extension.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/reliable-compaction
```

```text
/reload
```

The extension has no commands or settings. It activates automatically when Pi starts compaction for
a model with a configured reliability policy.

## Persistence

The extension stores no state. It arms a temporary provider override through documented extension
APIs, then lets Pi create its normal compaction entry. The override is removed when the summary
settles, when Pi records compaction, before later agent work, or when the session shuts down.
