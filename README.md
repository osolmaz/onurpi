# OnurPi

OnurPi is a workspace for Pi coding agent extensions, themes, and a reproducible global
configuration.

## Packages

| Package                                                            | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`@onurpi/turn-fold`](packages/turn-fold/)                         | Bounded transcript replay and run-level folding                  |
| [`@onurpi/goal`](packages/goal/)                                   | Bounded autonomous goals with no-progress circuit breakers       |
| [`@onurpi/loop-guard`](packages/loop-guard/)                       | Opt-in bounded detection and interruption of repeated work       |
| [`@onurpi/live-stats`](packages/live-stats/)                       | Shimmering Turkish working messages with live response metrics   |
| [`@onurpi/nyan-mode`](packages/nyan-mode/)                         | Animated bitmap Nyan Cat context runway                          |
| [`@onurpi/prompt-queue`](packages/prompt-queue/)                   | Editable prompt queue, steer control, and history manager        |
| [`@onurpi/reliable-compaction`](packages/reliable-compaction/)     | Stable transport policy for context compaction                   |
| [`@onurpi/context-window-policy`](packages/context-window-policy/) | Model-relative context compaction threshold                      |
| [`@onurpi/startup-model`](packages/startup-model/)                 | Stable process-start model selection                             |
| [`@onurpi/infinite-retry`](packages/infinite-retry/)               | Infinite capped retries with `Alt+R` manual wake                 |
| [`@onurpi/codex-usage`](packages/codex-usage/)                     | Codex reports and model-gated weekly usage                       |
| [`@onurpi/plan-checklist`](packages/plan-checklist/)               | Branch-aware model task plan with live progress                  |
| [`@onurpi/unified-exec`](packages/unified-exec/)                   | Persistent shell and PTY sessions with race-free completion wake |
| [`@onurpi/yarp`](packages/yarp/)                                   | Prunes long output from supported developer commands             |
| [`@onurpi/regrafter-driver`](packages/regrafter-driver/)           | Optional delegation to the dedicated Regrafter app               |
| [`@osolmaz/pi-reviewer`](packages/pi-reviewer/)                    | Standalone Pi Factory reviewer with P0–P3 findings               |
| [`@onurpi/theme`](packages/onur-theme/)                            | Portable `onur-dark` Pi theme                                    |

## Included extension dependencies

OnurPi installs these extensions as pinned package dependencies and loads them from `node_modules`.
Their source remains in the original repositories.

| Extension          | Source                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------- |
| Hugging Face OAuth | [`osolmaz/pi-huggingface-oauth`](https://github.com/osolmaz/pi-huggingface-oauth) 0.1.1 |
| Pi Must Win        | [`osolmaz/pi-must-win`](https://github.com/osolmaz/pi-must-win) 0.2.0                   |
| Pi Regraft         | [`osolmaz/pi-regraft`](https://github.com/osolmaz/pi-regraft) 0.3.0                     |
| Pi Workflows       | [`osolmaz/pi-workflows`](https://github.com/osolmaz/pi-workflows) at `630622e`          |
| Pi Demo Mode       | [`osolmaz/pi-demo-mode`](https://github.com/osolmaz/pi-demo-mode) at `8f18a38`          |

Demo Mode stays inactive unless `PI_DEMO_MODE=1` is set. Regrafter stays out of ordinary prompts
unless its driver skill matches an explicit delegation or vendored-code maintenance request. YARP
stays inactive unless its `yarp` binary is on `PATH`; see the [YARP package README](packages/yarp/).

## Install

The root manifest registers every extension and the `onur-dark` theme, so one package entry covers
the whole workspace:

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

Each extension is an independent package under `packages/` with its own `package.json` and entry
point. Tests and a README live beside the source. The theme follows the same package layout and
registers its JSON file through `pi.themes`. The private root manifest registers every resource for
workspace-wide development.

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

Pi Reviewer is a standalone binary and is not loaded into normal Pi sessions. Configure its model
outside the review extension, then review a branch:

```bash
npm run build --workspace @osolmaz/pi-reviewer
npm link --workspace @osolmaz/pi-reviewer
pi-reviewer config set model openai-codex/gpt-5.6-terra
pi-reviewer config set thinking high
pi-reviewer config set auth pi
pi-reviewer --base main
```

Mutation testing remains available as an optional manual check:

```bash
npm run mutate
```
