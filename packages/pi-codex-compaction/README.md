# @onurpi/pi-codex-compaction

OpenAI Codex native remote compaction, vendored from
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-codex-compaction)
and integrated into Pi's existing compaction lifecycle. See [UPSTREAM.md](UPSTREAM.md) for the pin,
the security review, and the local adaptations.

## Behavior

When the active model uses the built-in `openai-codex` provider with the `openai-codex-responses`
API, the extension serves Pi's manual, threshold, and overflow compaction events as a
`session_before_compact` provider. It sends the finalized Responses history to the official Codex
endpoint with a trailing `compaction_trigger`, stores the returned opaque `compaction` item in Pi's
real `CompactionEntry.details`, and lets Pi rebuild the active transcript from that boundary. The
Codex switcher overrides that same provider in place, so direct compaction requests use the account
leased to the current agent run.

The extension never triggers compaction itself. It registers no `turn_end`, `agent_settled`, or
`session_compact` handlers, never calls `ctx.abort()` or `ctx.compact()` for its own lifecycle, and
sends no continuation message. Pi's native scheduler checks the context before each assistant
response, including responses after tool results. OnurPi reserves 27,200 tokens for its default
272,000-token Codex model, so Pi starts threshold compaction at 90% and resumes the same agent run.

Pi requires compaction events to store a summary string, so entries receive a short local checkpoint
marker. The marker is filtered from provider context and is never sent to OpenAI. Pi renders the
operation with its built-in transient compaction indicator. The extension does not add status
entries to the session.

Native compaction activates only for the built-in `openai-codex` provider. Other providers pass
through every hook unchanged and never receive the opaque checkpoint or the local marker. The
extension performs no text-summary model call.

## Branch snapshot fence

Remote compaction is asynchronous: the request body is computed from the `branchEntries` snapshot of
the `session_before_compact` event, and the response arrives later. Before the extension returns a
native checkpoint, it checks that the active branch still contains the same entries in the same
order. If any entry changed or appeared, the extension discards the checkpoint and cancels Pi's
compaction without content. This keeps a remote checkpoint from being inserted between a function
call and its result or into another active branch.

## Fail-closed policy

- If a native compaction request fails, is aborted, or is fenced out by a moved branch, Pi's
  compaction is cancelled and the previous history remains intact. The extension never silently
  falls back to Pi text summarization.
- If the persisted native checkpoint on the active branch is malformed or belongs to a different
  Codex model, the next provider request is aborted rather than rebuilt from a bad checkpoint.
- Active Codex credentials are sent only to a validated official Codex endpoint (`chatgpt.com`,
  `chat.openai.com`, or `api.openai.com` over HTTPS). A custom or arbitrary model base URL disables
  native compaction with an error instead of receiving the ChatGPT OAuth token.

## Compaction ownership in OnurPi

- **`@onurpi/codex-switcher`** keeps the built-in `openai-codex` provider identity while it changes
  the active account.
- **Pi's native scheduler** owns manual, threshold, and overflow timing. The normal compaction
  settings put the default Codex threshold at 90%.
- **`@onurpi/pi-codex-compaction`** owns the remote native checkpoint and compaction content for the
  built-in `openai-codex` provider.
- **`@onurpi/reliable-compaction`** stabilizes ordinary Pi text compaction for other custom
  providers that use the `openai-codex-responses` API. It passes `openai-codex` through because
  native compaction replaces its text-summary path.

The root manifest registers Codex routing, native content, and text fallback in that order. The
repository tests assert the order and the native compaction settings.

## Persistence

Session state only: the native checkpoint lives in Pi's normal `CompactionEntry.details` (opaque
`encrypted_content` from OpenAI plus the replacement history). Resume, forks, tree navigation, and
repeated compaction derive state from the newest checkpoint on the active branch. The transient Pi
status indicator is not saved. No other files are created.

## Limitations

Native checkpoints are model-specific. Switch back to the model that created the checkpoint before
continuing; with any other model selected, requests fail closed. Account switching keeps the same
provider and model identity, so it does not change checkpoint compatibility.

Pi does not expose a finalized provider payload during `session_before_compact`. The extension
mirrors Pi's Codex message conversion and combines it with the latest observed request shape to
construct the compaction request. Extensions loaded later that independently rewrite provider
payloads can therefore create order-dependent behavior.

## License

MIT, © Can Celik. See [LICENSE](LICENSE).
