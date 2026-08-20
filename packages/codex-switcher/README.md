# @onurpi/codex-switcher

`@onurpi/codex-switcher` lets one normal Pi `openai-codex` provider use several ChatGPT accounts. It
checks account usage and can move to the next account before a response starts.

The extension does not add providers such as `openai-codex-primary`. Pi keeps one provider, one
model list, and one session identity.

## Configuration

Create `~/.pi/agent/codex-switcher.json` with mode `0600`:

```json
{
  "accounts": [
    {
      "id": "primary",
      "billing": "subscription-only"
    },
    {
      "id": "backup",
      "billing": "allow-credits"
    }
  ],
  "usage": {
    "refreshMinutes": 5,
    "timeoutSeconds": 10
  }
}
```

```bash
chmod 600 ~/.pi/agent/codex-switcher.json
```

Array order defines preference and fallback order. Account IDs use lowercase letters, digits, and
single hyphens.

`subscription-only` stops an account when a subscription window reaches zero. `allow-credits`
permits paid credits only when the Codex usage response confirms that credits remain.

The account manager can create and update this file. A missing file is the same as an empty account
list. The old `profiles` and `fallbackChain` format is not supported.

## Account manager

Reload Pi, then run:

```text
/codex-switcher
```

The interactive manager can:

- show account order, authentication, billing policy, usage, and reset time;
- add and authenticate an account;
- reauthenticate or remove an account;
- change billing policy;
- move an account up or down.

Command forms are also available:

```text
/codex-switcher status
/codex-switcher add primary subscription-only
/codex-switcher login primary
/codex-switcher billing primary allow-credits
/codex-switcher move primary up
/codex-switcher remove primary
```

Login uses Pi AI's official OpenAI Codex OAuth implementation. Credentials are stored in
`~/.pi/agent/codex-switcher-auth.json` with mode `0600`. The extension writes this file atomically
and serializes changes across Pi processes. It never puts credentials in the policy file.

Do not use `/login openai-codex` for switcher accounts. The switcher account manager owns these
credentials.

## Routing

Each new agent run starts at the first configured account. The extension skips unauthenticated
accounts and accounts that confirmed they have no permitted usage.

If the usage endpoint is unavailable, the extension tries the account. A confirmed usage-limit error
can move to the next account only before the provider emits text, thinking, or a tool call. This
prevents duplicate answers and duplicate tool calls.

The first semantic event locks the account for the complete agent run. Tool continuations, retries,
and compaction use that same account. A later limit error ends the run instead of changing accounts
mid-run. The account manager does not change the locked account until the run finishes.

An exhausted cached window expires at its reported reset time. The next agent run then starts at the
top of the list and can return to the preferred account.

The switcher does not add account or usage text to Pi's bottom status area. Use
`/codex-switcher status` for account details. The separate Pi Usage package owns the shared usage
display.

## Migration from profile providers

The replacement does not copy old credentials or keep compatibility providers.

Before updating, run `/logout` and select each old alias provider to remove its credential. After
updating, replace the old configuration with the ordered `accounts` format and authenticate each
account through `/codex-switcher`. Fresh login avoids copying credentials between stores.

## Pi Factory

The package declares `openai-codex` under `piFactory.providers`. Pi Factory can load
`provider-module.ts` without loading the account-management command or other OnurPi extensions.
Normal Pi and Pi Factory use the same provider construction, vault, usage policy, routing, OAuth
refresh, and account lease rules.

A Pi Factory app selects its own model. The provider module does not read or write normal Pi's
selected model. It reads the existing policy and vault under the main Pi agent directory and does
not copy credentials into the app profile.

The provider module keeps one account selected for the complete Pi Factory run. Its start, finish,
and close functions cover tools, retries, compaction, finalization, cancellation, and cleanup.

## Session restore

Pi 0.84.x checks saved-session authentication before it applies provider registrations from
extensions. The switcher installs a short-lived, version-locked startup adapter so this early check
can recognize a configured account in the existing switcher vault.

The adapter changes only the `openai-codex` readiness result while Pi restores the session. It
reports readiness only when valid switcher configuration names an account that exists in the vault.
It delegates all other providers and states to Pi. After Pi binds the switcher provider, the adapter
restores the original runtime method and normal provider authentication takes over.

The readiness check returns only a boolean. It does not return, copy, refresh, log, or rewrite a
credential. The adapter does not choose a model, read session entries, or append a model change.
Missing or invalid switcher state keeps Pi's normal fallback behavior.

This adapter supports Pi 0.84.x only. It will be removed when Pi releases provider registration
before saved-model restoration.

## Security and state

The extension accepts only the official `openai-codex` provider and official ChatGPT Codex endpoint.
It sends account credentials only to the official OpenAI OAuth, Codex API, and Codex usage
endpoints.

Policy and vault files must be regular files with mode `0600`. The vault is bounded, validated,
locked, and replaced atomically. OAuth refresh happens under the vault lock so concurrent Pi
processes do not overwrite a rotated token.

Usage reports and salted credential fingerprints stay in memory. Status and errors never include
credential values. The extension adds no custom session entries.

## Limits

- The extension supports Pi versions from 0.84.2 through 0.84.x. The startup adapter rejects an
  unsupported runtime version.
- Pi currently stores one credential for each provider ID. The switcher therefore owns its account
  vault until Pi exposes public named credential profiles.
- A configuration syntax error leaves the built-in provider unchanged and exposes only a diagnostic
  `/codex-switcher` command.
