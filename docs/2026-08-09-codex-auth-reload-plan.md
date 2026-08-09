---
title: Codex auth reload plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-09
---

# Codex auth reload plan

## Status

Implemented. The provider wrapper, global registration, tests, and startup smoke check described
below are complete.

## Purpose

Every running Pi session should use a newly written Codex CLI credential on its next OpenAI Codex
request. Today, `codex login` updates `${CODEX_HOME:-~/.codex}/auth.json`, while Pi keeps using its
separate credential until the session is reloaded or restarted.

Codex itself keeps one coherent in-memory credential and performs guarded reloads. It accepts a
replacement credential automatically only when the account ID matches the current account. This
extension applies the same account guard by wrapping Pi's built-in Codex provider through the public
provider registration API.

## Design

Add an independent global package at `packages/codex-auth-reload`.

The extension overlays only Pi's built-in `openai-codex` `streamSimple` handler. Pi keeps the
runtime provider's catalog models, login, refresh, and auth behavior, while the overlay delegates to
the public built-in Codex transport. Immediately before each stream dispatch, the wrapper will:

1. Confirm that the model uses the exact official `https://chatgpt.com/backend-api` endpoint. It
   will preserve Pi's auth without reading the CLI credential for every custom endpoint.
2. Read at most 1 MiB from the Codex CLI auth file in place. It honors `CODEX_HOME` and otherwise
   uses `~/.codex/auth.json`.
3. Validate the JSON shape, three-segment access-token JWT, account ID, and token expiry without
   logging credential material.
4. Read the account ID from Pi's normally resolved OAuth API key, with a request-header fallback.
5. Replace the resolved API key only when the Codex file belongs to that same account.
6. Preserve Pi's resolved auth unchanged when the file is absent, malformed, expired, or belongs to
   another account.

The built-in Codex streaming implementation derives its authorization and account headers from the
replacement API key after this step. The auth file is read at the request boundary, so each Pi
process observes changes independently. A background watcher and cross-process service are
unnecessary. The extension does not write to either credential store.

## Scope

- New private package `@onurpi/codex-auth-reload` with an extension entry point, parser, account
  guard, tests, README, and standard OnurPi quality configuration.
- Public provider-wrapper registration, root Pi manifest, settings synchronization, package-loading
  tests, coverage, Slophammer, CI package lists, and README package table.
- Safe tests with structural fake JWTs and temporary auth files.
- A multi-instance test proving that two running provider instances adopt a same-account token
  replacement independently.

## Limits

- Pi's existing OpenAI Codex OAuth credential must still resolve so the provider reaches its normal
  request-auth step.
- The extension reloads credentials before a provider request. Pi retries reuse the auth from the
  original request, so it cannot replace credentials in the middle of that request's retry loop.
- Cross-account changes are rejected. Users must log in through Pi or start a new explicitly
  configured session to change accounts.
- This package supports Codex's file credential store. Keyring-only Codex credentials are outside
  the documented extension boundary.
- Native compaction performs its own direct request. Its request builder calls the package's shared
  endpoint-guarded selection helper, and its remote request path retains its separate endpoint
  validation.

## State and API impact

- **Session state:** none. The extension appends no session entries.
- **Other persistent data:** none. It reads the Codex auth file and changes only the existing
  tracked and live Pi package settings needed to load the extension.
- **Pi internals:** none.
- **Public API:** `ExtensionAPI.registerProvider`, the public built-in `openaiCodexProvider`
  factory, `lazyStream`, and the `streamSimple` provider overlay contract.

## Acceptance criteria

- Two already-running provider instances use a replacement token on their next request when its
  account ID matches.
- Missing, malformed, incomplete, oversized, expired, and cross-account credentials leave Pi's
  resolved auth unchanged.
- Custom endpoints never cause the Codex CLI credential to be read or applied.
- The wrapped provider updates the API key that the built-in Codex transport uses to derive request
  headers.
- Credential values never appear in errors, snapshots, docs, or logs.
- Native Codex compaction uses the same endpoint-guarded credential selection helper.
- Pi starts with the package loaded from the canonical OnurPi path.

## Verification

- Package `npm run check` and `npm run slophammer`.
- Provider-wrapper tests that assert the resolved API key changes before built-in transport
  dispatch.
- Root `npm run check`, `npm run slophammer`, `git diff --check`, and SimpleDoc check.
- `npm run settings:reset`, `npm run settings:sync`, and `pi list`.
- A temporary Pi startup smoke test that lists `codex-auth-reload` without making a provider
  request.
- Pi Reviewer against `main`, followed by pull-request CI.
