---
title: Codex switcher implementation plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-20
tags: [pi, codex, oauth, usage]
---

# Codex switcher implementation plan

## Status

The one-provider switcher, selective Pi Factory integration, and version-locked startup adapter for
resumed normal Pi sessions are implemented. The cross-repository design lives in the
[selective Pi profile inheritance plan](https://github.com/osolmaz/pi-factory/blob/main/docs/2026-08-21-selective-profile-inheritance-plan.md).

## Purpose

The current Codex switcher turns each account into a separate Pi provider. This duplicates the
`openai-codex` provider, model list, compaction rules, and session identity. Account identity must
stay separate from provider identity.

Replace the aliases with one `openai-codex` provider. The extension will route that provider through
an ordered set of local account profiles. It will keep OAuth credentials in a protected local vault,
check account usage, and select a safe fallback before semantic output starts.

The first account in the configured list is preferred. An account can use paid credits only when its
billing policy is `allow-credits`.

## Requirements

- Keep one provider and one model list named `openai-codex`.
- Authenticate more than one ChatGPT account through the official Codex OAuth flow.
- Keep account names, policy, and credentials outside the public repository.
- Use one ordered account list as both preference order and fallback chain.
- Prefer the first usable account at the start of each agent run.
- Keep the serving account fixed after semantic output starts.
- Use the same account for tool continuations, retries, and compaction in that agent run.
- Return to a higher-priority account on a later run after its reported limit resets.
- Never use paid credits unless local policy permits them.
- Never repeat text, thinking, or tool calls while changing accounts.
- Provide a clear interactive command for account setup and maintenance.
- Use the same provider implementation in normal Pi and selected Pi Factory runtimes.
- Let a Pi Factory app choose its own model without changing normal Pi's selected model.
- Keep the existing policy and vault paths and do not copy credentials into an app profile.

## Local data

Read policy from `~/.pi/agent/codex-switcher.json`:

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

Array order defines preference and fallback order. Account IDs use lowercase letters, digits, and
single hyphens. The configuration contains no credentials.

Store OAuth credentials in a separate extension-owned vault under `~/.pi/agent`. The vault must:

- be a bounded regular file with mode `0600`;
- reject symbolic links and unsafe file types;
- use serialized, atomic updates;
- preserve standard OAuth refresh, access, expiry, and account metadata;
- never expose credentials through status, errors, logs, tests, or session entries;
- send credentials only to the official OpenAI OAuth, Codex API, and usage endpoints.

Use a narrow vault interface so a future public Pi named-credential API can replace the file without
changing the router.

## Provider integration

Load the public built-in OpenAI Codex provider and override it in place with `pi.registerProvider`.
Keep its provider ID, model catalog, model IDs, API type, endpoint, and stream semantics. Replace
its auth resolution and stream functions with switcher-owned wrappers.

The auth resolver reports the provider as configured when at least one configured account has a
vault credential. The router supplies the selected account credential directly to the built-in Codex
stream. It must not forward a placeholder credential.

Use the official public OpenAI Codex OAuth implementation for login and refresh. Do not implement a
second OAuth protocol and do not read Codex CLI credentials.

## Resumed-session startup

Pi 0.84.x restores an existing session model before it applies provider registrations queued during
extension loading. Its early authentication check therefore sees only the built-in `openai-codex`
provider and canonical `auth.json`. A session saved with an account from the switcher vault can be
rejected and replaced by an unrelated authenticated model before the switcher provider is bound.

Add one version-locked startup adapter for Pi 0.84.x. During the asynchronous extension factory,
after configuration and vault setup but before resource loading returns, temporarily wrap the public
exported `ModelRuntime.prototype.hasConfiguredAuth` method. The wrapper changes only the
`openai-codex` result during this startup window. It reports configured authentication when valid
switcher configuration selects at least one account that exists in the protected vault. It delegates
every other provider and every nonmatching Codex state to Pi's original method.

The vault exposes a synchronous boolean readiness check for this adapter. The check parses the
existing private vault with its normal validation and file-safety rules. It does not return, copy,
log, refresh, or rewrite a credential. Missing configuration, invalid configuration, an unsafe or
invalid vault, and no matching configured account do not produce a positive result.

Guard the wrapper against duplicate installation and reload. Keep its state under a versioned global
symbol, compose safely with an existing compatible installation, and restore the exact original
method after `session_start`. Also restore it on `session_shutdown`, initialization failure, and
explicit cleanup. Installation must reject unsupported Pi versions rather than patch an unknown
runtime shape.

The adapter does not choose or change a model. It does not read session entries, append a model
change, or suppress a warning after the fact. It only makes the existing pre-session authentication
check recognize provider-owned authentication. After `AgentSession` binds queued providers, the
normal switcher provider owns authentication, refresh, routing, and the account lease.

Remove this adapter by hard cutover when Pi exposes and releases provider registration before model
restoration. Do not keep the adapter beside a native startup contract.

## Pi Factory provider module

Move provider construction, vault access, usage checks, routing state, auth resolution, and run
lifetime into shared code. Each call creates independent in-memory provider state and continues to
use the existing locked vault.

Keep two thin adapters:

- The normal Pi extension registers the provider, maps documented Pi lifecycle events, and keeps the
  `/codex-switcher` account manager.
- The Pi Factory provider module exports contract version 1, `createProvider`, and a default
  provider-only Pi extension. It does not add the account manager or another package resource.

Declare the provider module under `piFactory.providers` with provider ID `openai-codex`, its module
path, and this package's normal extension as the activation extension. Pi Factory can then find and
load this provider without executing every OnurPi extension.

The provider module receives the main agent directory and may use the current built-in provider. It
does not receive app prompts, tools, commands, sessions, policy, or credential values. It returns
the complete provider and start, finish, and close functions for one high-level run.

The same account stays selected across all model calls in that run, including tools, retries, and
compaction. Pi Reviewer chooses its model in its own runtime. The module does not read or write
normal Pi's selected model.

This work does not change, migrate, or copy the policy file or vault. A selected provider-module
failure is final and must not fall back to the built-in provider.

## Account manager

`/codex-switcher` opens an interactive account manager. It supports:

- status for configured order, auth state, billing policy, usage, and reset time;
- login and reauthentication through official OAuth;
- credential removal after confirmation;
- account reordering and billing-policy changes by updating the local policy file safely.

The package must also give clear noninteractive diagnostics when UI methods are unavailable.

Existing alias credentials are not copied automatically. Migration uses fresh OAuth login in the new
account manager. Before installing the replacement, users remove old alias credentials through Pi's
normal logout flow. The runtime keeps no compatibility provider or fallback reader.

## Routing

At `before_agent_start`, clear any prior account lease and begin a new routing run. For the first
model request:

1. Read accounts in configured order.
2. Skip accounts without credentials.
3. Query cached or current usage from the official usage endpoint.
4. Skip an exhausted `subscription-only` account.
5. Use an exhausted `allow-credits` account only when the usage response confirms available credits.
6. Try an account when usage is unavailable, then let the provider response decide.

The router may move to the next account only for confirmed usage exhaustion before the provider
emits text, thinking, or a tool call. Abort, auth, network, endpoint, and model errors remain
terminal.

The first semantic event commits the account lease. Every later model call in the same agent run
uses that account. A later limit failure remains terminal instead of changing the account mid-run.
Clear the lease when the agent run ends.

Each new agent run starts from the first configured account. Cache entries for exhausted windows
expire at their reported reset time. This lets later runs return to the preferred account without a
manual selection.

## Replacement scope

Remove:

- generated `openai-codex-<account>` providers;
- `providerId` fields derived from account IDs;
- Codex-family model and message conversion for provider aliases;
- internal model selection between aliases;
- special `openai-codex-*` handling and package dependencies in context-window and compaction code;
- old configuration parsing and compatibility aliases.

Keep the existing usage parser and billing decision rules where they still apply to account IDs.

## Boundaries

- **Session state:** The extension adds no custom session entries. All assistant messages use
  `openai-codex`. The startup adapter does not read or change saved model history.
- **Other persistent data:** One local policy file and one protected credential vault. The startup
  adapter adds no file or stored value.
- **Pi internals:** One narrow, reversible wrapper around the public exported
  `ModelRuntime.prototype.hasConfiguredAuth` method for the Pi 0.84.x startup window. It follows the
  same reviewed, version-locked adaptation policy as Turn Fold.
- **Public API:** `ModelRuntime`, `registerProvider`, `registerCommand`, documented lifecycle
  events, `ctx.ui`, and public `pi-ai` OpenAI Codex provider and OAuth exports.

## Non-goals

- Changing Pi's credential schema, source code, or installed package files.
- Patching model choice, session history, or providers other than `openai-codex`.
- Supporting arbitrary Codex-compatible endpoints.
- Reading or importing Codex CLI credentials.
- Copying existing Pi credentials without explicit source-and-destination approval.
- Keeping old provider aliases or old configuration readers.
- Falling back for general request failures.

## Acceptance criteria

- `/model` shows one `openai-codex` provider and its normal model list.
- The extension can keep and refresh at least two OAuth credentials without provider aliases.
- The ordered account list controls preference and fallback.
- Billing policy prevents unapproved credit use.
- Confirmed pre-output exhaustion can move to the next account.
- Semantic output commits one account for the complete agent run.
- All agent-start paths establish the run boundary, and account management cannot change the leased
  account before the run settles.
- A later run returns to a higher-priority account after factual reset evidence.
- Compaction and context policy use normal built-in `openai-codex` behavior.
- No credential or private account value enters tracked files, session entries, logs, or test
  output.
- The old alias implementation and its direct integration dependencies are gone.
- Normal Pi and Pi Factory use the same provider construction and routing code.
- Pi Factory loads only the provider module and does not expose `/codex-switcher` in the app.
- A Pi Factory app can select its own model without changing normal Pi settings.
- The provider module uses the existing vault in place and creates no fallback credential.
- Resuming a session saved with an available `openai-codex` model and a matching switcher vault
  account restores that model without a false warning or unrelated provider fallback.
- Missing or invalid switcher state delegates to Pi's original authentication result and fallback.
- The startup adapter restores the exact original runtime method after provider binding and on every
  cleanup path.
- Fresh sessions, explicit model selection, model cycling, built-in providers, and unrelated custom
  providers keep their existing behavior.
- Unsupported Pi versions fail before the adapter changes runtime behavior.

## Verification

Run:

- configuration and vault tests, including file permissions, unsafe files, atomic writes, and
  redacted failures;
- routing tests for preference, billing, unknown usage, pre-output fallback, post-output pinning,
  continuations, reset recovery, aborts, and unrelated errors;
- account-manager tests with fake OAuth and UI interactions;
- integration tests for one provider identity and normal compaction/context handling;
- startup-adapter tests for matching vault readiness, missing and invalid state, canonical auth
  delegation, unrelated providers, duplicate installation, reload, cleanup, unsupported Pi versions,
  and provider-registration isolation after startup rejection;
- synthetic fresh-session and resumed-session tests that check the selected model and warning
  without reading real sessions or credentials;
- `npm run check` and `npm run slophammer` in the switcher package;
- checks for every directly changed integration package;
- repository checks, SimpleDoc, `git diff --check`, and a temporary Pi extension startup test;
- code review against `main` until no P0 or P1 findings remain;
- pull-request CI before merge;
- provider-module discovery and loading through Pi Factory;
- equivalent provider, auth, routing, compaction, and lifecycle behavior through both adapters;
- concurrent Pi Factory runtimes with independent run state and the existing locked vault;
- a check that normal Pi model settings and credential files remain unchanged.

## Implementation result

The implementation follows this plan. The provider auth resolver also exposes the account leased by
the router through Pi's normal provider-auth path. This lets native Codex compaction use the same
account without a direct dependency on the switcher package. The lifecycle handler covers direct and
extension-triggered agent runs, and the account manager blocks changes to the leased account until
the run settles.

The startup adapter wraps the host Pi `ModelRuntime` only while Pi resolves the initial or saved
model. A synchronous vault check returns only whether valid configuration has a matching stored
account. Synthetic SDK and real temporary Pi resume tests verify that Pi restores the saved Codex
model without the false warning. Startup cleanup restores the original method before model requests
begin. The extension validates the startup adapter and its lifecycle cleanup before it queues its
provider. If startup rejects the Pi version or lifecycle setup, no switcher provider is queued. Pi
therefore keeps the built-in provider or another extension's queued provider unchanged.

## Related work

This plan replaces the earlier alias design in this document and the
[Codex auth reload plan](2026-08-09-codex-auth-reload-plan.md).

The cross-repository provider-module, Pi Factory runtime, Pi Reviewer integration, release order,
and failure rules live in the
[selective Pi profile inheritance plan](https://github.com/osolmaz/pi-factory/blob/main/docs/2026-08-21-selective-profile-inheritance-plan.md).
