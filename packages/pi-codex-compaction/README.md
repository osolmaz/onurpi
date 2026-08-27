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
sends no continuation message. Pi's serialized built-in threshold, overflow, and manual compaction
lifecycle stays in charge of when compaction happens.

Pi requires compaction events to store a summary string, so entries receive a short local checkpoint
marker. The marker is filtered from provider context and is never sent to OpenAI. In interactive
mode, each native compaction adds durable `OpenAI compaction running…` / complete / failed status
entries to the chat transcript; these custom entries are never included in model context.

Native compaction activates only for the built-in `openai-codex` provider. Other providers pass
through every hook unchanged and never receive the opaque checkpoint or the local marker. The
extension performs no text-summary model call.

## Branch snapshot fence

Remote compaction is asynchronous: the request body is computed from the `branchEntries` snapshot of
the `session_before_compact` event, and the response arrives later. Before the extension returns a
native checkpoint, it re-reads the active branch and compares it with the recorded snapshot tip.
Only non-context status entries from the same compaction operation may appear after that tip. If the
branch moved, changed, or gained any context-bearing entry — for example an assistant function call
whose result is still pending — the extension discards the checkpoint, cancels Pi's compaction
without content, and records a failed status with a bounded error. This fail-closed fence keeps a
remote checkpoint from being spliced between a function call and its function result.

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

- **`@onurpi/pi-codex-compaction`** owns all compaction content for the built-in `openai-codex`
  provider: the remote native checkpoint and the compaction entry. Pi itself owns the manual,
  threshold, and overflow triggers.
- **`@onurpi/reliable-compaction`** still stabilizes ordinary Pi text compaction for other custom
  providers that use the `openai-codex-responses` API, but passes `openai-codex` through because
  native compaction replaces its text-summary path.

The root manifest registers `pi-codex-compaction` before `reliable-compaction`, and the repository
tests assert that ordering.

## Persistence

Session state only: the native checkpoint lives in Pi's normal `CompactionEntry.details` (opaque
`encrypted_content` from OpenAI plus the replacement history), and TUI status updates are appended
as `openai-codex-compaction-status` custom entries that never enter model context. Resume, forks,
tree navigation, and repeated compaction derive state from the newest checkpoint on the active
branch. No other files are created.

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
