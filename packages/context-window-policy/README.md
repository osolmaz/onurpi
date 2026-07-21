# @onurpi/context-window-policy

`@onurpi/context-window-policy` asks Pi to compact active context when usage reaches 90% of the
selected model's context window.

The threshold follows each model instead of using one fixed token reserve. A 272,000-token model
compacts at 244,800 tokens, a 200,000-token model at 180,000, and a 128,000-token model at 115,200.
The extension evaluates after every model response and after idle model changes, so tool-use
continuations and switches to smaller models use the selected model's current limit.

Pi still owns compaction. The extension calls Pi's documented `compact()` API and does not replace
summary generation, retained-history selection, transport policy, overflow recovery, or session
persistence. Pi's built-in threshold remains enabled as a fallback. `@onurpi/reliable-compaction`
can independently select a stable transport after this extension requests compaction.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/context-window-policy
```

```text
/reload
```

The extension has no commands or settings. It derives the threshold from the active model
automatically.

## Public-API limitation

Pi does not currently expose an awaitable pre-provider compaction barrier. The extension can
evaluate after provider responses and on idle model changes, but a newly submitted user message that
alone crosses 90% may reach the provider before the extension can request compaction. Pi's built-in
pre-prompt and overflow handling remain available as fallbacks. Exact pre-request percentage
enforcement requires a future public Pi compaction-policy API.

## Persistence

The extension stores no state and appends no custom session entries. Its duplicate-prevention guard
exists only for the current extension runtime. Pi may append its ordinary compaction entry after a
request succeeds.
