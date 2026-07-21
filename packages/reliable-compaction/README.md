# @onurpi/reliable-compaction

`@onurpi/reliable-compaction` makes Pi compaction use a stable transport when a provider's default
transport is unsuitable for long summaries.

For models using the `openai-codex-responses` API, the extension runs compaction over SSE instead of
WebSocket. It preserves Pi's normal summary preparation, split-turn handling, custom instructions,
file tracking, thinking level, authentication, and automatic overflow recovery.

A failed compaction is retried once because Pi does not append the compaction entry until a complete
result exists. Cancellation is never retried. If both attempts fail, the extension cancels
compaction and reports the error instead of falling back to the failing transport.

Providers without a transport policy continue through Pi's default compaction behavior.

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

The extension stores no state. Successful compactions create only Pi's normal compaction entry
through the documented `session_before_compact` hook.
