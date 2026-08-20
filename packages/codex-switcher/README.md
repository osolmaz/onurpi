# @onurpi/codex-switcher

`@onurpi/codex-switcher` lets Pi keep separate OpenAI Codex OAuth credentials and move through a
usage-aware fallback chain. Each account is a normal Pi provider alias, so Pi owns login, token
refresh, and credential storage.

## Configuration

Create `~/.pi/agent/codex-switcher.json`:

```json
{
  "profiles": {
    "primary": {
      "label": "Primary",
      "billing": "subscription-only"
    },
    "backup": {
      "label": "Backup",
      "billing": "allow-credits"
    }
  },
  "fallbackChain": ["primary", "backup"],
  "usage": {
    "refreshMinutes": 5,
    "timeoutSeconds": 10
  }
}
```

Profile IDs use lowercase letters, digits, and single hyphens. The extension converts each profile
to a provider named `openai-codex-<profile-id>`.

`subscription-only` stops that profile when a subscription window reaches zero. `allow-credits`
permits billable credit use when the subscription is exhausted and the Codex usage response confirms
that credits remain.

Reload Pi after a configuration change. Then sign in to each provider:

```text
/login openai-codex-primary
/login openai-codex-backup
```

Select the first provider with `/model`, or set it as Pi's default provider. Run `/codex-switcher`
to see the fallback order, authentication state, billing policy, and last known usage state.

## Routing rules

The selected profile defines the preferred start of the chain. A run selected on `primary` can move
to `backup`; a run selected on `backup` does not move back to `primary`.

The extension checks the official Codex usage endpoint before each request, with a short in-memory
cache. An exhausted cached window expires as soon as its reported reset time passes. If the usage
endpoint is unavailable, the extension tries the request and lets the provider response decide.

A confirmed usage-limit error can cause fallback only before the provider emits text, thinking, or a
tool call. Errors after output starts remain on the account that started the response. This avoids
duplicate partial answers and duplicate tool calls.

After a fallback starts output, the extension keeps that profile for later model calls in the same
agent run. It temporarily selects the serving profile so tool continuations, automatic retries, and
native compaction use the same account. When the run fully settles, it restores the preferred
profile. The next run can then return to a higher-priority account when its cached limit expires or
on the first request after its reported reset time passes.

## Security and state

The configuration contains labels and policy only. It must not contain credentials. Pi stores one
OAuth credential for each generated provider ID in its normal auth store.

The extension sends profile credentials only to the official ChatGPT Codex API and official Codex
usage endpoint. It keeps usage reports and salted credential fingerprints in memory and clears them
when the process ends. It adds no custom session entries.

## Limits

- The extension needs Pi 0.84.2 or newer.
- Configuration changes require `/reload` because provider aliases are registered at extension load
  time.
- Native remote compaction uses the profile leased to the current agent run.
- The built-in `openai-codex` provider remains available, but it is outside the switcher chain.
