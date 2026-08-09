# @onurpi/codex-auth-reload

`@onurpi/codex-auth-reload` lets already-running Pi sessions use a new same-account Codex CLI login
on their next OpenAI Codex request.

Codex CLI and Pi keep separate credential stores. The extension reads
`${CODEX_HOME:-~/.codex}/auth.json` immediately before the built-in Codex provider dispatches a
request and replaces its API key only when both credentials identify the same ChatGPT account. Each
Pi process checks the file independently, so no background service or session restart is needed.

## Behavior

- Overlays only the built-in `openai-codex` provider's `streamSimple` handler through Pi's public
  `registerProvider` API. Runtime catalog models, login, refresh, and auth behavior stay intact.
- Reads at most 1 MiB and validates the Codex access-token JWT, account ID, and expiration before
  use.
- Keeps Pi's current credential when the Codex file is missing, unreadable, malformed, expired, or
  belongs to another account.
- Changes the resolved API key only when the model uses the exact official
  `https://chatgpt.com/backend-api` endpoint. Custom endpoints never receive or read the CLI
  credential.
- Lets the built-in provider derive its authorization and account headers from the selected API key
  normally.
- Exports the same endpoint-guarded selection for native Codex compaction's direct request.

The extension reads the Codex credential in place. It never writes or copies credentials, creates
files, appends session entries, or logs tokens, account IDs, file contents, or hashes.

## Install

OnurPi registers this package globally. Reload an existing Pi session once after installing the
package:

```text
/reload
```

After that initial package load, later same-account `codex login` changes need no reload. Submit the
next Pi prompt normally.

## Limits

Pi's existing Codex OAuth credential must still resolve so the wrapped provider can reach its normal
request-auth step. A credential written during an active retry loop is used by the next provider
request rather than midway through that retry loop.

Cross-account changes are rejected, matching Codex's guarded unauthorized-recovery behavior. Use
Pi's login flow or start a newly configured session to change accounts.

The package supports Codex's file credential store. Codex keyring-only credentials are not available
through the documented Pi extension APIs.

## Persistence

The extension keeps no session state and writes no persistent data.
