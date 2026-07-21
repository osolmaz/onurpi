# @onurpi/context-window-policy

`@onurpi/context-window-policy` asks Pi to compact active context when usage reaches 90% of the
selected model's context window.

The threshold follows each model instead of using one fixed token reserve. A 272,000-token model
requests compaction at 244,800 tokens, and a 200,000-token model requests it at 180,000. The
extension evaluates after each complete agent run and after idle model changes. Waiting for
`agent_settled` ensures Pi has finished every tool continuation before its public compaction API
stops the agent runtime.

Pi still owns compaction. The extension calls Pi's documented `compact()` API and does not replace
summary generation, retained-history selection, transport policy, overflow recovery, or session
persistence. Pi's built-in threshold remains enabled as a fallback. With Pi's default 16,384-token
reserve, this extension reaches 90% first for context windows of at least 163,840 tokens. On smaller
windows, Pi's fixed reserve can compact earlier. `@onurpi/reliable-compaction` can independently
select a stable transport after this extension requests compaction.

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

Pi does not currently expose a non-aborting automatic-compaction request or an awaitable
pre-provider compaction barrier. The extension therefore waits for the complete agent run to settle
before calling the public manual compaction API. It cannot compact between a tool result and the
model continuation, and a newly submitted user message that alone crosses 90% may reach the provider
before the extension can request compaction. Pi's built-in pre-prompt and overflow handling remain
available as fallbacks. Exact mid-run and pre-request percentage enforcement requires a future
public Pi compaction-policy API.

Pi reports extension-triggered compactions as manual because `ctx.compact()` has no automatic reason
option. Turn Fold consequently leaves their summaries standalone rather than attaching them to the
preceding turn.

## Persistence

The extension stores no state and appends no custom session entries. Its duplicate-prevention guard
exists only for the current extension runtime. Pi may append its ordinary compaction entry after a
request succeeds.
