---
title: Codex switcher implementation plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-20
tags: [pi, codex, oauth, usage]
---

# Codex switcher implementation plan

## Status

Implemented.

## Purpose

Pi stores one credential for each provider ID. The built-in `openai-codex` provider therefore cannot
hold several ChatGPT accounts at the same time.

Replace `@onurpi/codex-auth-reload` with an independent `@onurpi/codex-switcher` package. The new
extension will register one OpenAI Codex provider alias for each configured account profile. Each
alias will use Pi's normal OAuth login and credential store. The extension will check account usage
before a request and move through a configured fallback chain when an account cannot serve it.

The first use case has two profiles:

- A primary subscription profile stops when its subscription limit reaches zero.
- A backup profile can continue with available credits after its subscription limit reaches zero.

The configuration is the permission boundary for paid credits. A profile uses credits only when its
policy is `allow-credits`.

## Configuration

Read nonsecret configuration from `~/.pi/agent/codex-switcher.json`. The extension will not write
this file.

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

Profile IDs must use lowercase letters, digits, and single hyphens. A profile named `primary`
becomes the Pi provider `openai-codex-primary`. The fallback chain must contain every configured
profile exactly once.

The extension will reject invalid configuration at load time with a short error that does not
contain credential data. If the file does not exist, the package will load only a diagnostic command
that gives the path and setup steps.

After Pi reloads the configuration, each account gets its own normal login flow:

```text
/login openai-codex-primary
/login openai-codex-backup
```

Pi owns OAuth persistence and refresh. The switcher will never read or copy the Codex CLI auth file.

## Routing

Each profile provider will clone the public model catalog and OAuth behavior from Pi's built-in
OpenAI Codex provider. The provider model IDs and API stay unchanged. Only the provider ID and
display name change.

A request starts at the selected profile's place in the fallback chain. The router performs these
steps for each remaining profile:

1. Resolve that profile's current auth through `modelRegistry.getProviderAuth`.
2. Use `@onurpi/pi-usage` to read the official Codex usage endpoint, with an in-memory cache.
3. Skip a `subscription-only` profile when its applicable subscription window has no remaining
   allowance.
4. Keep an `allow-credits` profile eligible after subscription exhaustion only when the usage
   response shows available, unlimited, or positive credits.
5. Try the profile when usage is unavailable. The provider response remains the final source of
   truth.

The cache defaults to five minutes. It is keyed by a salted fingerprint of resolved request auth,
contains no raw credential, and ends with the Pi process.

The router will buffer provider events until it sees semantic output. A terminal usage-limit error
before text, thinking, or a tool call starts will discard that attempt, mark the usage cache stale,
and try the next profile. After semantic output starts, the router will return the error without
fallback. This rule prevents a second account from repeating a partial answer or tool call.

Authentication errors, network errors, malformed responses, aborts, and ordinary provider errors
will not trigger account fallback. They remain visible to the user.

After a successful fallback, the extension will select the successful profile model through
`ExtensionAPI.setModel`. Later turns will therefore start from the profile that served the request.

## Codex family integration

The Codex transport contains provider-specific message conversion. Before dispatch, the switcher
will map profile models and prior profile assistant messages to the built-in `openai-codex`
provider. It will map emitted assistant messages back to the profile that served the request. This
keeps tool-call and reasoning replay compatible while preserving the actual account profile in Pi's
session history.

The profile aliases also need the same native compaction path as the built-in provider. Update
`pi-codex-compaction`, `context-window-policy`, and `reliable-compaction` to recognize the switcher
provider prefix. Codex-family checkpoint keys will use the built-in provider identity, so a profile
change for the same model does not create a false model mismatch. Native compaction will use the
selected profile's Pi auth directly. It will not perform account fallback because a compaction
request can replace session history and must have one clear account owner.

## Commands and status

Register `/codex-switcher` as a read-only diagnostic command. It will show:

- The configuration path and fallback order.
- Each profile's provider ID, auth state, billing policy, and last known usage state.
- The profile that served the last request.

The extension will publish a short `codex-switcher` status value for the active profile. It will
clear that value at session shutdown. It will not add custom session entries.

## Cutover

Remove `@onurpi/codex-auth-reload` in the same change. Update the root manifest, settings source,
workspace checks, package table, and compaction dependency to use `@onurpi/codex-switcher`.

This is a hard cutover. The old Codex CLI file reload behavior and package exports will not remain
as compatibility paths. The built-in `openai-codex` provider stays available for users who do not
select a switcher profile.

## State and API impact

- **Session state:** Assistant messages keep Pi's normal schema and record the profile provider that
  served them. The extension adds no custom session entries.
- **Other persistent data:** The user supplies one nonsecret JSON configuration file. Pi stores one
  OAuth credential per profile provider in its existing auth store. The extension writes neither.
- **Pi internals:** None.
- **Public API:** `registerProvider`, `registerCommand`, `setModel`, provider auth status and
  resolution through `modelRegistry`, lifecycle events, UI status, the public built-in Codex
  provider factory, and public assistant stream events.

## Acceptance criteria

- Pi can keep separate OAuth credentials for at least two Codex profile providers.
- A valid fallback chain chooses the first authenticated and eligible profile at or after the
  selected profile.
- A subscription-only profile never uses credits after its subscription allowance reaches zero.
- An allow-credits profile can serve a request with confirmed credits after subscription exhaustion.
- Unknown usage does not block a request.
- A terminal usage-limit error before semantic output moves to the next eligible profile.
- No error after semantic output, auth error, network error, or user abort moves to another profile.
- The profile that completes a fallback becomes the selected model for the next turn.
- Tool calls and reasoning replay use Codex-compatible provider conversion.
- Native compaction recognizes profile aliases and uses the selected profile credential.
- Errors, tests, docs, status text, and session entries contain no tokens, account IDs, credential
  hashes, or auth file contents.
- Pi starts with the package loaded through the canonical OnurPi package path.

## Verification

- Parser tests for missing, valid, invalid, duplicate, and unsafe profile configuration.
- Routing tests for proactive skips, credit policy, unknown usage, auth gaps, sticky success,
  aborts, pre-output usage-limit fallback, and post-output error handling.
- Stream mapping tests for models, assistant history, partial events, final messages, and tool
  calls.
- Compaction and context-policy tests for built-in and profile providers.
- Package and workspace checks, coverage, Slophammer, `git diff --check`, and SimpleDoc.
- A temporary Pi startup check with a test configuration and isolated auth store.
- Pi Reviewer against `main`, followed by pull-request CI.

## Related work

This plan replaces the [Codex auth reload plan](2026-08-09-codex-auth-reload-plan.md).
