# @onurpi/context-window-policy

`@onurpi/context-window-policy` prevents long Codex tool loops from consuming the full model context
before Pi can compact it.

## Behavior

Pi normally checks automatic compaction after the complete agent run returns. A run can contain many
model and tool turns, so a long tool loop can cross Pi's threshold and continue until the footer
correctly shows `0%` context remaining.

This extension checks Pi's current context usage after each completed turn for the built-in
`openai-codex` provider. At 90% of the selected model's context window, it stops a tool-driven run
before the next provider request, waits for `agent_settled`, and calls Pi's public `compact()`
method. `@onurpi/pi-codex-compaction` then supplies the native OpenAI checkpoint through the normal
`session_before_compact` event.

Before it aborts a tool-driven run, the extension records whether Pi has queued work. This state
must survive until settlement because `ctx.abort()` can move pending messages out of Pi's queue.
After `agent_settled`, the extension defers its safety check to the next timer turn. This gives
later synchronous settlement handlers time to start or queue their work. The extension then keeps
the compaction request pending until Pi is idle. It records `session_before_compact` when a
compaction starts. It observes `session_compact` on success and `session_compact_failed` on failure.
It reuses a successful external compaction or retries after an external failure instead of starting
a competing manual compaction. It disables its own continuation when another turn appears. After
successful compaction, it checks once more and sends one hidden custom continuation message only
when no competing turn appeared before or after abort. This keeps queued user work ahead of the
continuation and prevents a duplicate turn.

If Pi's built-in threshold or overflow compaction runs first, the extension uses that successful
compaction and does not start a duplicate. Overflow recovery remains owned by Pi.

A final assistant turn is not interrupted. If that completed response reaches 90%, the extension
compacts after settlement and does not start an unnecessary model turn.

The threshold is model-relative. A 272,000-token Codex model stops at 244,800 tokens. The Nyan
footer uses the same Pi context-usage value, so it normally shows 10% remaining when this policy
stops a tool loop. The footer remains truthful: `0%` still means Pi reported that the context was
exhausted or over the model window.

## Safety

The policy owns timing only. It does not construct summaries or checkpoints and does not change
`@onurpi/pi-codex-compaction` branch fencing. Native compaction remains fail-closed if the branch
changes while the remote request is in flight.

If compaction fails, the extension does not continue the interrupted run near the context limit. It
reports the error in interactive mode and allows a later turn or Pi's built-in overflow path to
retry safely.

## Persistence

Pi appends its normal compaction entry. An interrupted tool loop also receives one hidden custom
message with the text `Compaction completed. Continue.` after compaction succeeds. The extension
stores no other persistent data. Duplicate-prevention state exists only in memory for the current
extension runtime.

## Public APIs

The extension uses only documented Pi APIs: `turn_end`, `agent_settled`, `session_before_compact`,
`session_compact`, `session_compact_failed`, `model_select`, `session_start`, `session_shutdown`,
`ctx.getContextUsage()`, `ctx.abort()`, `ctx.compact()`, `ctx.hasPendingMessages()`, `ctx.isIdle()`,
and `pi.sendMessage()`.

## Verification

The queue regressions must cover pending work that exists before abort but is no longer reported
after `agent_settled`, plus work that another extension starts or queues at settlement. They must
also cover an external compaction that starts in a later settlement handler. The tests must prove
that these cases do not start competing compactions or duplicate turns. Run the package and
repository checks from this checkout:

```bash
cd packages/context-window-policy
npm run check
npm run slophammer
cd ../..
npm run check
npm run slophammer
git diff --check
pi list
pi --no-session --mode rpc </dev/null
```

Before merge, run `pi-reviewer --base main` until it reports no P0 or P1 findings. Confirm that pull
request CI is green, post the final report, use rebase merge, and verify the merged `main` state and
installed package path.

## Install

From the OnurPi repository root, install the local package and reload Pi:

```bash
pi install ./packages/context-window-policy
```

```text
/reload
```

The extension has no settings or commands.
