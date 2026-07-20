# OnurPi

OnurPi is a workspace for Pi coding agent extensions and a reproducible global configuration.

## Packages

| Package                                                    | Purpose                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`@onurpi/turn-fold`](packages/turn-fold/)                 | Turn-level transcript folding that preserves the final response |
| [`pi-tui-history-replay`](packages/pi-tui-history-replay/) | Vendored full visible branch history across context compaction  |
| [`@onurpi/live-stats`](packages/live-stats/)               | Bold Turkish working messages with live response metrics        |
| [`@onurpi/nyan-mode`](packages/nyan-mode/)                 | Animated bitmap Nyan Cat context runway                         |
| [`@onurpi/prompt-queue`](packages/prompt-queue/)           | Editable prompt queue, steer control, and history manager       |

## Install

The root manifest registers every extension, so one package entry covers the whole workspace:

```bash
pi install git:github.com/osolmaz/onurpi
```

Run `/reload` in an existing Pi session after installation. After new commits land on `main`, run
`pi install git:github.com/osolmaz/onurpi` again (or `pi update --extensions`) and `/reload` to pick
them up.

## Global settings

[`settings.json`](settings.json) is the source-controlled copy of the global Pi settings at
`~/.pi/agent/settings.json`. Pi authentication, session history, trust decisions, and model-provider
state remain outside this repository. Review settings for credentials or machine-specific values
before committing future changes.

Two scripts keep the copies in agreement without ever leaking machine-local development state. Both
derive the canonical package entries from the root manifest (`pi.extensions`), so the list never
needs manual maintenance:

```bash
npm run settings:sync   # live settings -> tracked settings.json, repo entries normalized
npm run settings:reset  # normalize the live ~/.pi/agent/settings.json in place
```

An entry counts as belonging to this repo when it points into the main checkout, into an
`onurpi-worktrees/` worktree, or at `git:github.com/osolmaz/onurpi`. Those entries are replaced with
one canonical `../../repos/onurpi/packages/<name>` entry per registered package. External entries
(npm packages, other git repos) and all other settings pass through untouched. During development
the live file may point anywhere, including a worktree or a dev-only package, and `sync` still
writes the correct canonical values to the tracked copy.

## Structure

Each extension is an independent package under `packages/` with its own `package.json` and entry
point. Tests and a README live beside the source. Package manifests declare Pi entry points through
`pi.extensions`. The private root manifest also registers them for workspace-wide development.

This workspace follows the package-directory structure used by
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions), while keeping shared
TypeScript quality tooling at the workspace root.

## Development

Extensions are developed from a live Pi session. Edit a checkout, then run `/reload`. On this
machine the canonical install is per-package local paths into the main checkout, so `/reload` picks
up local edits directly. To develop in a worktree instead, point the live settings entry at the
worktree path; when done, `npm run settings:reset` restores the canonical entries and
`npm run settings:sync` updates the tracked copy.

Quick-test without touching settings at all:

```bash
pi -e .
```

Quality gates:

```bash
npm ci
npm run check
npm run slophammer
```

Mutation testing remains available as an optional manual check:

```bash
npm run mutate
```
