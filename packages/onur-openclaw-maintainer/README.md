# @onurpi/onur-openclaw-maintainer

`@onurpi/onur-openclaw-maintainer` starts a read-only maintainer workflow for OpenClaw issues about
local models, self-hosted providers, model routing, and related infrastructure.

The extension can open a specific issue or show the curated issue inventory from
[`osolmaz/onurclaw`](https://github.com/osolmaz/onurclaw). It then starts the bundled workflow
through `pi-workflows` in the current Pi session.

## Usage

Start Pi in an OpenClaw checkout and choose an issue:

```bash
pi --openclaw-maintainer
```

Start with an exact issue:

```bash
pi --openclaw-maintainer --openclaw-issue 111886
```

From an existing Pi session:

```text
/openclaw-maintainer https://github.com/openclaw/openclaw/issues/111886
```

`pi-workflows` must also be installed and loaded. OnurPi bundles the required version.

## Workflow

The workflow:

1. reads the live issue and current OpenClaw code;
2. explains the problem plainly;
3. runs the cheapest honest reproduction or proof;
4. judges whether the right fix is local or general;
5. presents the evidence and next human decision.

Every run is explicitly marked as a workflow test. The package blocks Pi's `edit` and `write` tools
plus Git and GitHub commands that commit, push, comment, close, create, or merge while the run is
active. The workflow also requires a clean worktree before accepting its proof step.

This package does not implement, commit, publish, comment, close, or merge. Use a separate
authorized maintainer session after reviewing the result.

## Data and APIs

The selected issue and normal workflow prompts become ordinary Pi session messages. `pi-workflows`
stores normalized run state under `~/.pi/agent/workflows/state.sqlite` and may append its hidden
result-presentation message. This package writes no sidecar state and uses no Pi internals. It uses
Pi's documented command dispatch to call the public `/workflow` command.
