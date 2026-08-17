# OnurPi agents

`@onurpi/agents` contains Onur Solmaz's personal agent instructions and skills. Pi loads the skills
directly from this package, while the synchronization script installs the same resources for Codex,
Claude Code, and Cursor.

The package is private and is not published to npm.

## Pi

The OnurPi root manifest registers the top-level skills in this package. Local OnurPi settings point
to `packages/agents`, so Pi does not need copied skills under its global configuration directory.

Run these commands from the OnurPi repository after a checkout update:

```sh
npm run settings:reset
npm run settings:sync
npm run agents:sync
```

The final command copies `AGENTS.md` to Pi but removes personal skill copies that were managed by
the old tools repository. It does not change unrelated global skills.

## Other agent harnesses

`npm run agents:sync` copies skills and global instructions to:

- Codex
- Claude Code
- Cursor

Use `--dry-run` to preview changes. Use `--skip-codex`, `--skip-claude`, `--skip-cursor`, or
`--skip-pi` to limit destinations. Skill names can be passed as positional arguments for a selective
update.

```sh
npm run agents:sync -- --dry-run
npm run agents:sync -- amk plain-writing
```

The script uses state files to remove only copies that it manages. A full synchronization prunes
removed managed skills by default. A selective synchronization keeps other managed skills unless
`--prune` is given.

## SimpleDoc skill

Refresh the checked-in SimpleDoc skill from a local SimpleDoc checkout:

```sh
npm run agents:sync-simpledoc
```

Set `SIMPLEDOC_REPO` or pass `--source` when the checkout is elsewhere. Use `--check` to report
drift without changing the checked-in copy.
