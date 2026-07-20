# OnurPi

OnurPi is a workspace for Pi coding agent extensions and a reproducible global configuration.

## Packages

| Package                                                    | Purpose                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`@onurpi/turn-fold`](packages/turn-fold/)                 | Turn-level transcript folding that preserves the final response |
| [`pi-tui-history-replay`](packages/pi-tui-history-replay/) | Vendored full visible branch history across context compaction  |
| [`@onurpi/live-stats`](packages/live-stats/)               | Live elapsed time, output tokens, and recent output throughput  |
| [`@onurpi/prompt-queue`](packages/prompt-queue/)           | Editable prompt queue, steer control, and history manager       |

## Install

The root manifest registers every extension, so one package entry covers the whole workspace:

```bash
pi install git:github.com/osolmaz/onurpi
```

Run `/reload` in an existing Pi session after installation. After new commits land on `main`, run
`pi install git:github.com/osolmaz/onurpi` again (or `pi update --extensions`) and `/reload` to
pick them up.

## Global settings

[`settings.json`](settings.json) is the source-controlled copy of the global Pi settings at
`~/.pi/agent/settings.json`. Pi authentication, session history, trust decisions, and model-provider
state remain outside this repository. Review settings for credentials or machine-specific values
before committing future changes.

Update the tracked copy after changing Pi settings:

```bash
cp ~/.pi/agent/settings.json settings.json
```

Apply the tracked settings from the repository root:

```bash
cp settings.json ~/.pi/agent/settings.json
```

## Structure

Each extension is an independent package under `packages/` with its own `package.json` and entry
point. Tests and a README live beside the source. Package manifests declare Pi entry points through
`pi.extensions`. The private root manifest also registers them for workspace-wide development.

This workspace follows the package-directory structure used by
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions), while keeping shared
TypeScript quality tooling at the workspace root.

## Development

Extensions are developed from a live Pi session: edit the working tree, then `/reload`. That only
works while the installed package points at the working tree instead of the GitHub clone, so the
workspace has two modes, switched with one command:

```bash
npm run pi:dev     # settings point at ~/repos/onurpi; /reload picks up local edits
npm run pi:stable  # settings point at git:github.com/osolmaz/onurpi (pushed code)
```

Use dev mode while working on an extension. Once the work is merged, switch back to stable mode so
sessions load pinned, pushed code and are immune to branch switches and uncommitted edits. Both
modes register the same extensions through the root manifest. Never leave both entries installed
at once; the extensions would load twice.

Quick-test without touching settings at all:

```bash
pi -e .
```

Quality gates:

```bash
npm ci
npm run check
npm run mutate
npm run slophammer
```
