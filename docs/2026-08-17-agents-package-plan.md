---
title: Move personal agent resources into OnurPi
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-17
---

# Move personal agent resources into OnurPi

Onur wants OnurPi to become the single source for his personal agent instructions and skills, in the same broad style as Armin Ronacher's `agent-stuff` package. The existing installation scripts must remain available for Codex, Claude Code, and Cursor. Pi must load the skills from the OnurPi package instead of copied files.

This change replaces `tools/agents` with a private `@onurpi/agents` package. The tools repository will retain only a notice that points to the new source.

## Requirements

- Move every tracked personal instruction, skill, helper, reference, asset, and maintenance script from `tools/agents` into `onurpi/packages/agents`.
- Remove the unused prompt and workflow folders. They were deleted before this migration.
- Keep cross-harness installation for Codex, Claude Code, and Cursor.
- Copy global `AGENTS.md` instructions to Pi, but do not copy skills into Pi's global skill folder.
- Load Pi skills through the documented `pi.skills` package manifest field.
- Replace the old source in place. Do not keep a second skill source or a fallback reader.
- Leave a short move notice at `tools/agents/README.md`.
- Keep external skills, including Hugging Face-managed skills under `.agents`, unchanged.
- Remove the redundant `plain-language` skill and keep `amk` as the single plain-explanation skill.

## Assumptions

- OnurPi remains a public repository, while `@onurpi/agents` stays private from npm publication through `private: true`.
- The current Python synchronization scripts can be replaced with tested TypeScript scripts because OnurPi already requires Node.js and TypeScript.
- The old synchronization state is trusted only as a list of paths previously managed by the tools repository.

## Package design

`packages/agents` will contain:

```text
packages/agents/
├── package.json
├── README.md
├── AGENTS.md
├── scripts/
│   ├── sync-simpledoc-skill.ts
│   └── sync-skills.ts
├── skills/
├── sync-simpledoc-skill.test.ts
├── sync-skills.test.ts
└── repository.test.ts
```

The package manifest will export only top-level skill files with `./skills/*/SKILL.md`. This prevents the sandbox-specific OpenClaw inventory skill from loading as a normal personal skill.

The root OnurPi manifest will register the same package skill path. Settings synchronization will then produce one canonical local package entry for `packages/agents`.

## Synchronization behavior

The refactored `sync-skills.ts` script will:

- Copy top-level skills and global instructions to Codex, Claude Code, and Cursor.
- Copy only global instructions to Pi.
- Keep dry-run, selective skill, destination override, skip, and prune controls.
- Reject duplicate skill names, invalid skill frontmatter, and source symlinks.
- Copy through temporary paths so interrupted runs do not leave partial skills.
- Read legacy `.tools-agents-skill-sync.json` state during the first run.
- Remove legacy Pi skill copies only when the legacy state identifies them as managed.
- Write `.onurpi-agents-sync.json` for destinations that still receive copied skills.
- Never read, move, or delete unrelated skills.

The refactored `sync-simpledoc-skill.ts` script will preserve source validation, drift checks, dry-run behavior, file modes, and atomic replacement.

## Repository changes

### OnurPi

- Add `@onurpi/agents` and all moved resources.
- Register the package in the root Pi manifest and normalized settings.
- Add root npm commands for cross-harness synchronization and SimpleDoc refresh.
- Update OnurPi documentation and package-loading tests.
- Ignore moved skill prose in Prettier so migration does not rewrite skill content.

### Tools

- Remove the old instructions, skills, and scripts after the OnurPi package is merged and verified.
- Keep `agents/README.md` as a move notice with the new repository path and commands.
- Update the root README and repository instructions so they name OnurPi as the source.

## Non-goals

- Publishing `@onurpi/agents` to npm.
- Moving Hugging Face-managed skills from the global `.agents` folder.
- Changing the meaning of personal skills, except for source-path updates and removal of the duplicate `plain-language` skill.
- Adding Pi extensions or changing Pi internals.
- Retaining old install commands, copied Pi skills, or source aliases after the replacement.

## Acceptance criteria

- OnurPi contains every tracked file that remains relevant from `tools/agents`.
- Pi discovers each intended personal skill exactly once from `packages/agents`.
- The sandbox-only nested `SKILL.md` is not registered as a normal Pi skill.
- Codex, Claude Code, and Cursor receive the copied skills and instructions.
- Pi receives instructions and no copied personal skills.
- Legacy managed copies are removed without touching unrelated skills.
- The tools repository contains no agent source files outside the move notice.
- Both repositories have clean local checks, reviewed pull requests, and green required CI.

## Verification

Run in OnurPi:

```sh
npm install
npm run settings:reset
npm run settings:sync
npm run check
npm run slophammer
git diff --check
pi list
```

Run the synchronization tests against temporary homes. Then run a real synchronization after the OnurPi change is merged. Confirm that Pi lists `packages/agents`, that personal skill files resolve from OnurPi, and that external `.agents` skills remain present.

Run in tools:

```sh
npx -y @simpledoc/simpledoc check
git diff --check
```

Finally, search both repositories for stale `tools/agents` installation instructions and for removed prompt or workflow paths.

## Pi contract impact

- **Session state:** Normal Pi session entries do not change.
- **Other persistent data:** Pi settings gain the local `packages/agents` entry. Global instruction files and cross-harness skill copies change through the explicit synchronization command.
- **Pi internals:** None.
- **Public API:** The package uses the documented `pi.skills` manifest field and local package installation behavior.
