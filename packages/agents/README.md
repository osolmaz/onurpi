# OnurPi agents

`@onurpi/agents` contains the public skills and shared installer for OnurPi. Global instructions and
private skills come from the sibling private agent repository and are never stored in OnurPi.

The package is private to the workspace and is not published to npm.

## Install

Keep the public and private repositories as sibling checkouts under `~/repos`, install the OnurPi
dependencies, and run:

```sh
npm run agents:sync
npm run agents:check
```

The first command validates both skill sources and the private instruction file before it writes
anything. It installs the private instruction file unchanged for Pi, Codex, Claude Code, and Cursor.
It installs the combined public and private skill set for Codex, Claude Code, and Cursor. Pi loads
public skills from OnurPi and private skills from `~/.agents/skills`.

Use `--dry-run` to run preflight checks without changing installed files. Use `--skip-codex`,
`--skip-claude`, `--skip-cursor`, or `--skip-pi` to limit destinations. Skill names can be passed as
positional arguments for a selective update.

```sh
npm run agents:sync -- --dry-run
npm run agents:sync -- amk plain-writing
```

A full sync prunes only skills recorded as managed by this installer. A selective sync keeps other
managed skills unless `--prune` is given. Skill directories and instruction files are replaced
atomically. A repeated sync repairs an interrupted installation.

Private contents are read only during synchronization. They are never copied into this repository,
its tests, or generated tracked files.

## SimpleDoc skill

Refresh the checked-in SimpleDoc skill from a local SimpleDoc checkout:

```sh
npm run agents:sync-simpledoc
```

Set `SIMPLEDOC_REPO` or pass `--source` when the checkout is elsewhere. Use `--check` to report
drift without changing the checked-in copy.
