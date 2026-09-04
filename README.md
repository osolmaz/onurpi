# OnurPi

OnurPi is [Onur Solmaz's](https://solmaz.io/) personal setup for the
[Pi coding agent](https://pi.dev/). It keeps the extensions, tools, skills, theme, and settings I
use for daily software work in one installable repository.

I build these packages for my own workflow, but each package is self-contained so others can use or
adapt the parts they want. More of my work is available at [solmaz.io](https://solmaz.io/) and on
[GitHub](https://github.com/osolmaz).

## Contents

| Package                                                                  | Purpose                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`@onurpi/agents`](packages/agents/)                                     | Personal agent instructions, skills, and cross-harness sync      |
| [`@onurpi/turn-fold`](packages/turn-fold/)                               | Bounded transcript replay and run-level folding                  |
| [`@onurpi/goal`](packages/goal/)                                         | Bounded autonomous goals with no-progress circuit breakers       |
| [`@onurpi/loop-guard`](packages/loop-guard/)                             | Opt-in bounded detection and interruption of repeated work       |
| [`@onurpi/live-stats`](packages/live-stats/)                             | Shimmering Turkish working messages with live response metrics   |
| [`@onurpi/skill-slug`](packages/skill-slug/)                             | Invoke skills by typing their bare slug                          |
| [`@onurpi/nyan-mode`](packages/nyan-mode/)                               | Animated bitmap Nyan Cat context runway                          |
| [`@onurpi/prompt-queue`](packages/prompt-queue/)                         | Editable prompt queue, steer control, and history manager        |
| [`@onurpi/restart`](packages/restart/)                                   | Full Pi process restart on the exact persisted session           |
| [`@onurpi/codex-switcher`](packages/codex-switcher/)                     | Usage-aware Codex account profiles and fallback routing          |
| [`@onurpi/pi-codex-compaction`](packages/pi-codex-compaction/)           | OpenAI Codex native remote compaction (vendored)                 |
| [`@onurpi/reliable-compaction`](packages/reliable-compaction/)           | Stable transport policy for context compaction                   |
| [`@onurpi/infinite-retry`](packages/infinite-retry/)                     | Infinite capped retries with `Alt+R` manual wake                 |
| [`@onurpi/onur-openclaw-maintainer`](packages/onur-openclaw-maintainer/) | Read-only OpenClaw local-model issue workflow                    |
| [`@onurpi/pi-usage`](packages/pi-usage/)                                 | Multi-provider usage reports and model-gated usage status        |
| [`@onurpi/pi-session`](packages/pi-session/)                             | Bounded, read-only recovery views for Pi sessions                |
| [`@onurpi/plan-checklist`](packages/plan-checklist/)                     | Branch-aware model task plan with live progress                  |
| [`@onurpi/unified-exec`](packages/unified-exec/)                         | Persistent shell and PTY sessions with race-free completion wake |
| [`@onurpi/command-guard`](packages/command-guard/)                       | Fail-closed checks for destructive shell commands                |
| [`@onurpi/yarp`](packages/yarp/)                                         | Prunes long output from supported developer commands             |
| [`@onurpi/huggingface-oauth`](packages/huggingface-oauth/)               | Pinned Hugging Face OAuth and provider routes                    |
| [`@onurpi/pi-must-win`](packages/pi-must-win/)                           | Pi attribution and Unified Exec integration                      |
| [`@onurpi/workflows`](packages/workflows/)                               | Pinned workflow command and control tool                         |
| [`@onurpi/demo-mode`](packages/demo-mode/)                               | Opt-in self-driving demo mode                                    |
| [`@onurpi/regrafter-driver`](packages/regrafter-driver/)                 | Regraft command and optional Regrafter delegation                |
| [`@onurpi/theme`](packages/onur-theme/)                                  | Portable `onur-dark` Pi theme                                    |

[`@onurpi/pi-tui-kit`](packages/pi-tui-kit/) is a vendored library package (declarative Pi TUI
menus), not a Pi extension; it backs `@onurpi/pi-usage` and is not loaded as a Pi resource.

## Included external extensions

OnurPi loads external extensions through private wrapper packages under `packages/`. Each wrapper
owns its upstream pin and any OnurPi-specific integration. Their source remains in the original
repositories.

| Wrapper                                            | Source                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [`huggingface-oauth`](packages/huggingface-oauth/) | [`osolmaz/pi-huggingface-oauth`](https://github.com/osolmaz/pi-huggingface-oauth) 0.1.1 |
| [`pi-must-win`](packages/pi-must-win/)             | [`osolmaz/pi-must-win`](https://github.com/osolmaz/pi-must-win) at an immutable commit  |
| [`regrafter-driver`](packages/regrafter-driver/)   | [`osolmaz/pi-regraft`](https://github.com/osolmaz/pi-regraft) at an immutable commit    |
| [`workflows`](packages/workflows/)                 | [`@osolmaz/pi-workflows`](https://www.npmjs.com/package/@osolmaz/pi-workflows) 0.16.3   |
| [`demo-mode`](packages/demo-mode/)                 | [`osolmaz/pi-demo-mode`](https://github.com/osolmaz/pi-demo-mode) at `8f18a38`          |

Codex compaction has a single owner: `pi-codex-compaction` handles the built-in `openai-codex`
provider natively. The Codex switcher keeps that provider identity while changing its account
credential. `reliable-compaction` passes `openai-codex` through and keeps covering every other
model. See the
[package README](packages/pi-codex-compaction/README.md#compaction-ownership-in-onurpi).

Demo Mode stays inactive unless `PI_DEMO_MODE=1` is set. Regrafter stays out of ordinary prompts
unless its driver skill matches an explicit delegation or vendored-code maintenance request. YARP
stays inactive unless its `yarp` binary is on `PATH`; see the [YARP package README](packages/yarp/).

## Install

The root manifest registers every extension, personal skill, and the `onur-dark` theme, so one
package entry covers the whole workspace:

```bash
pi install git:github.com/osolmaz/onurpi
```

Installation creates `~/.local/bin/pi`, which starts the restart-aware launcher and then the
upstream Pi runtime. Keep `~/.local/bin` before the upstream Pi directory in `PATH`. Start one new
shell after the first installation so the shell resolves the new command path. The stable launcher
then survives upstream Pi reinstalls and keeps the normal `pi` command seamless.

Run `/reload` in an existing Pi session after installation. After new commits land on `main`, run
`pi install git:github.com/osolmaz/onurpi` again (or `pi update --extensions`) and `/reload` to pick
them up.

Pi loads public personal skills from [`@onurpi/agents`](packages/agents/). The agent installer reads
global instructions and private skills from a sibling private repository, then refreshes Pi, Codex,
Claude Code, and Cursor:

```bash
npm ci
npm run agents:sync
npm run agents:check
```

The private repository is required for instruction installation. OnurPi does not contain a global
`AGENTS.md` source.

## Global settings

[`settings.json`](settings.json) is the source-controlled copy of the global Pi settings at
`~/.pi/agent/settings.json`. Pi authentication, session history, trust decisions, and model-provider
state remain outside this repository. Review settings for credentials or machine-specific values
before committing future changes.

Two scripts keep the copies in agreement without ever leaking machine-local development state. Both
derive the canonical package entries from the root Pi resource manifest, so the list never needs
manual maintenance:

```bash
npm run settings:sync   # live settings -> tracked settings.json, repo entries normalized
npm run settings:reset  # normalize the live ~/.pi/agent/settings.json in place
```

An entry counts as belonging to this repo when it points into the main checkout, into an
`onurpi-worktrees/` worktree, or at `git:github.com/osolmaz/onurpi`. The replaced sources for Goal,
Unified Exec, and Codex Usage are also treated as repo-owned so they cannot coexist with the
vendored packages. Those entries are replaced with one canonical
`../../repos/onurpi/packages/<name>` entry per registered extension or theme package. External
entries (npm packages, other git repos) and all other settings pass through untouched.

Unified Exec replaces Pi's built-in `bash` tool and the old `shell-execution-policy` package. Its
attachment windows stay bounded, while the underlying session remains alive until it exits, is
killed, reaches the session cap, or Pi shuts down. That long-lived process model is required for
servers, interactive programs, and finite jobs that take more than two minutes.

During development the live file may point anywhere, including a worktree or a dev-only package, and
`sync` still writes the correct canonical values to the tracked copy.

## Structure

Each extension and command-line tool is an independent package under `packages/` with its own
`package.json` and entry point. Tests and a README live beside the source. The theme follows the
same package layout and registers its JSON file through `pi.themes`. The private root manifest
registers every Pi resource for workspace-wide development. See
[Adding packages to OnurPi](docs/adding-packages.md) before adopting another local or external
package.

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
