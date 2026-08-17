# @onurpi/pi-codex-compaction

OpenAI Codex native remote compaction, vendored from
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions/tree/main/packages/pi-codex-compaction)
and integrated into Pi's existing compaction lifecycle. See [UPSTREAM.md](UPSTREAM.md) for the pin,
the security review, and the local adaptations.

## Behavior

When the active model uses the built-in Codex provider (`openai-codex` with the
`openai-codex-responses` API), the extension intercepts Pi's manual, threshold, and overflow
compaction events. It sends the finalized Responses history to the official Codex endpoint with a
trailing `compaction_trigger`, stores the returned opaque `compaction` item in Pi's real
`CompactionEntry.details`, and lets Pi rebuild the active transcript from that boundary. Direct
compaction requests use `@onurpi/codex-auth-reload`, so a new same-account Codex CLI credential is
selected only for the official Codex endpoint and is never copied into Pi's auth store.

Pi owns compaction scheduling and continuation. The extension does not abort an active run or add a
synthetic user message. Manual compaction, Pi's configured threshold compaction, and overflow retry
all enter the same `session_before_compact` hook and receive a native Codex checkpoint.

Pi requires compaction events to store a summary string, so entries receive a short local checkpoint
marker. The marker is filtered from provider context and is never sent to OpenAI. In interactive
mode, each native compaction adds durable `OpenAI compaction running…` / complete / failed status
entries to the chat transcript; these custom entries are never included in model context.

Native compaction activates only for `openai-codex`. Other providers pass through every hook
unchanged and never receive the opaque checkpoint or the local marker. The extension performs no
text-summary model call.

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
  non-Codex model and passes `openai-codex`/`openai-codex-responses` models through untouched, so
  the two extensions never request duplicate or racing compactions.
- **`@onurpi/reliable-compaction`** still stabilizes ordinary Pi text compaction (SSE transport with
  one retry) for custom providers that use the `openai-codex-responses` API, but passes the built-in
  `openai-codex` provider through because native compaction replaces its text-summary path.

The root manifest registers `pi-codex-compaction` before both policy packages, and the repository
tests assert that ordering.

## Configuration

The extension has no configuration file. Use Pi's compaction settings, including
`compaction.reserveTokens`, to control threshold compaction.

## Persistence

Session state only: the native checkpoint lives in Pi's normal `CompactionEntry.details` (opaque
`encrypted_content` from OpenAI plus the replacement history), and TUI status updates are appended
as `openai-codex-compaction-status` custom entries. Resume, forks, tree navigation, and repeated
compaction derive state from the newest checkpoint on the active branch. No other files are created.

## Limitations

Native checkpoints are model-specific. Switch back to the model that created the checkpoint before
continuing; with any other model selected, requests fail closed. Provider switching is not a
portability path because no textual summary is generated.

Pi does not expose a finalized provider payload during `session_before_compact`. The extension
mirrors Pi's Codex message conversion and combines it with the latest observed request shape to
construct the compaction request. Extensions loaded later that independently rewrite provider
payloads can therefore create order-dependent behavior.

Pi does not expose a supported extension API for frontier compaction between tool turns. This
extension does not emulate that API. During long tool loops, Pi's normal threshold and overflow
behavior applies.

## License

MIT, © Can Celik. See [LICENSE](LICENSE).
