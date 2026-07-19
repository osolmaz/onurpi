# OnurPi

OnurPi is a workspace for Pi coding agent extensions and a reproducible global configuration.

## Packages

[`@onurpi/turn-fold`](packages/turn-fold/) provides turn-level transcript folding while preserving
the final response. [`pi-tui-history-replay`](packages/pi-tui-history-replay/) keeps the full
visible branch across context compaction.

[`@onurpi/live-stats`](packages/live-stats/) adds elapsed time, output tokens, and recent output
throughput to Pi's working row.

## Install

Clone the repository to `~/repos/onurpi`, install development dependencies, and register the local
extensions:

```bash
git clone https://github.com/osolmaz/onurpi.git ~/repos/onurpi
cd ~/repos/onurpi
npm ci
pi install ./packages/turn-fold
pi install ./packages/pi-tui-history-replay
pi install ./packages/live-stats
pi list
```

Run `/reload` in an existing Pi session after installation.

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

Each extension is an independent package under `packages/` with a manifest and entry point. Its
README and tests live beside the source. Package manifests declare Pi entry points through
`pi.extensions`. The private root manifest also registers them for workspace-wide development.

This workspace follows the package-directory structure used by
[`ogulcancelik/pi-extensions`](https://github.com/ogulcancelik/pi-extensions), while keeping shared
TypeScript quality tooling at the workspace root.

## Development

```bash
npm ci
npm run check
npm run mutate
npm run slophammer
```

Quick-test an extension without installing it permanently:

```bash
pi -e .
```
