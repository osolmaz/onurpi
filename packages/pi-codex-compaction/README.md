# @onurpi/pi-codex-compaction

OpenAI Codex native remote compaction, vendored from
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-codex-compaction)
and integrated into Pi's existing compaction lifecycle. See [UPSTREAM.md](UPSTREAM.md) for the pin,
the security review, and the local adaptations.

## Behavior

When the active model uses the built-in `openai-codex` provider with the `openai-codex-responses`
API, the extension intercepts Pi's manual, threshold, and overflow compaction events. It sends the
finalized Responses history to the official Codex endpoint with a trailing `compaction_trigger`,
stores the returned opaque `compaction` item in Pi's real `CompactionEntry.details`, and lets Pi
rebuild the active transcript from that boundary. The Codex switcher overrides that same provider in
place, so direct compaction requests use the account leased to the current agent run.

During a tool-driven run, the extension checks Pi's reported context usage after each completed
turn. At 90%, it aborts before the next provider request, waits for `agent_settled`, and invokes
Pi's normal compaction lifecycle. After successful compaction, it sends a hidden custom continuation
message unless messages are already queued. The model receives `Compaction completed. Continue.`,
but Pi does not render it as a user message. If Pi's threshold or overflow compaction runs first,
the extension uses that result instead of compacting twice. Overflow recovery remains owned by Pi.

The extension also announces this forced lifecycle through Pi's process-local event bus. When
`@onurpi/turn-fold` is loaded, it keeps the interrupted run open until compaction is attached. The
main transcript then shows `compacted` in the existing run summary instead of a standalone
compaction row. A failed compaction releases that display hold and settles the interrupted run.

Pi requires compaction events to store a summary string, so entries receive a short local checkpoint
marker. The marker is filtered from provider context and is never sent to OpenAI. In interactive
mode, each native compaction adds durable `OpenAI compaction running…` / complete / failed status
entries to the chat transcript; these custom entries are never included in model context.

Native compaction activates only for the built-in `openai-codex` provider. Other providers pass
through every hook unchanged and never receive the opaque checkpoint or the local marker. The
extension performs no text-summary model call.

## Fail-closed policy

- If a native compaction request fails or is aborted, Pi's compaction is cancelled and the previous
  history remains intact. The extension never silently falls back to Pi text summarization.
- If the persisted native checkpoint on the active branch is malformed or belongs to a different
  Codex model, the next provider request is aborted rather than rebuilt from a bad checkpoint.
- Active Codex credentials are sent only to a validated official Codex endpoint (`chatgpt.com`,
  `chat.openai.com`, or `api.openai.com` over HTTPS). A custom or arbitrary model base URL disables
  native compaction with an error instead of receiving the ChatGPT OAuth token.

## Compaction ownership in OnurPi

- **`@onurpi/pi-codex-compaction`** owns all compaction for the built-in `openai-codex` provider:
  the 90% mid-run threshold, the remote native checkpoint, and the compaction entry.
- **`@onurpi/context-window-policy`** keeps its model-relative 90% settlement compaction for every
  other model and passes `openai-codex` through untouched, so the two extensions never request
  duplicate or racing compactions.
- **`@onurpi/reliable-compaction`** still stabilizes ordinary Pi text compaction for other custom
  providers that use the `openai-codex-responses` API, but passes `openai-codex` through because
  native compaction replaces its text-summary path.

The root manifest registers `pi-codex-compaction` before both policy packages, and the repository
tests assert that ordering.

## Configuration

Turn-boundary compaction is enabled at 90% by default:

```json
{
  "autoCompact": true,
  "thresholdRatio": 0.9
}
```

Save this as `~/.pi/agent/pi-codex-compaction.json` or project-local `.pi/pi-codex-compaction.json`.
Project configuration applies only to trusted projects and takes precedence over global
configuration. `thresholdRatio` must be greater than 0 and less than 1. Pi's
`compaction.reserveTokens` still controls Pi's built-in threshold compaction.

## Persistence

Session state only: the native checkpoint lives in Pi's normal `CompactionEntry.details` (opaque
`encrypted_content` from OpenAI plus the replacement history), TUI status updates are appended as
`openai-codex-compaction-status` custom entries, and successful forced compaction appends one hidden
custom continuation message that enters model context. Resume, forks, tree navigation, and repeated
compaction derive state from the newest checkpoint on the active branch. Display coordination with
Turn Fold is process-local and appends no entry. No other files are created.

## Limitations

Native checkpoints are model-specific. Switch back to the model that created the checkpoint before
continuing; with any other model selected, requests fail closed. Account switching keeps the same
provider and model identity, so it does not change checkpoint compatibility.

Pi does not expose a finalized provider payload during `session_before_compact`. The extension
mirrors Pi's Codex message conversion and combines it with the latest observed request shape to
construct the compaction request. Extensions loaded later that independently rewrite provider
payloads can therefore create order-dependent behavior.

Pi does not expose a non-aborting compaction barrier between tool turns. The turn-boundary
controller therefore uses the documented `turn_end`, `agent_settled`, `abort()`, `compact()`,
`sendMessage()`, and event-bus interfaces. Aborting after a completed tool turn and sending a hidden
continuation message is a temporary compatibility path until Pi provides a direct turn-boundary
compaction interface.

## License

MIT, © Can Celik. See [LICENSE](LICENSE).
