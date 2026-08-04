---
title: Pi Must Win repository disable plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-04
---

# Pi Must Win repository disable plan

## Purpose

Pi Must Win adds `Co-Authored-By` and `Generated-By` trailers to every commit Pi creates. The user
wants to disable it for certain repos, and notes: "i might work with worktrees, so putting some
config in a single repo might not be enough." Disabling should also work for whole GitHub orgs.

Two constraints follow from that request:

1. The disable decision must key on repository identity, not on a working directory path, so every
   worktree of a disabled repo is covered without committing configuration into shared repositories
   such as `openclaw/*`.
2. Entries must match path prefixes on segment boundaries, so one entry can cover a single repo, a
   whole org, or a whole host.

## Scope

- One global user config file at `$XDG_CONFIG_HOME/pi-must-win/config.json` (default
  `~/.config/pi-must-win/config.json`), sibling to upstream's existing XDG state file.
- A load-time gate in the OnurPi wrapper package `packages/pi-must-win/index.ts`.
- Documentation in the package README.

## Non-goals

- No change to upstream `osolmaz/pi-must-win`; the gate lives in the OnurPi composition layer.
- No project-local `.pi` config file. Pi's documented project-local extension config
  (`.pi/<name>.json`) only propagates to worktrees when committed, which would pollute shared
  repositories.
- No per-command re-checks. The decision is made once when the extension loads; a session that
  starts in an allowed repo and later commits inside a disabled one still gets trailers.
- No separate handling of the GitHub star prompt. A disabled repo skips the whole extension for
  that session; the prompt fires on its own cadence in other sessions.

## Design

Config shape:

```json
{ "disabledRepos": ["github.com/openclaw", "~/experiments/junk"] }
```

- Entries are remote-URL keys or absolute local paths.
- URL entries in any remote syntax (`git@github.com:owner/repo.git`, `https://...`, `ssh://...`)
  normalize to a lowercase `host/path` key. An entry matches an identity key exactly or as a
  path-segment prefix, so `github.com/openclaw` covers the whole org while `github.com/open` does
  not match `github.com/openclaw`.
- Path entries (starting with `/` or `~`) match the main clone path exactly.
- A missing, unreadable, or malformed config file means "disable nothing".

Repository identity is resolved from the session working directory at extension load:

1. `git remote get-url origin`, normalized as above.
2. `git rev-parse --path-format=absolute --git-common-dir`, with a trailing `/.git` stripped. This
   yields the main clone path from every worktree, which is what path entries compare against.

When the identity matches a disabled entry, the wrapper returns before calling upstream
`piMustWin(pi)` and before subscribing to Unified Exec's command-environment event, so no hook
wrapping and no child-environment attribution happen for the session.

## Acceptance criteria

- Disabled repo: no `tool_call` wrapping, no Unified Exec subscription, no trailers on commits.
- Enabled repo: behavior unchanged.
- Identity resolution from a linked worktree returns the main clone path.
- The package keeps 100% statement/branch/function/line coverage.

## Verification

- `npm run check`, `npm run slophammer`, and `git diff --check` in `packages/pi-must-win`.
- `npx -y @simpledoc/simpledoc check` for this document.
- Pi Reviewer against `main`, then CI on the pull request.
