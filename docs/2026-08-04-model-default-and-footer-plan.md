---
title: Startup model removal and footer model order plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-04
---

# Startup model removal and footer model order plan

## Purpose

Two related pieces of model UX need fixing:

1. OnurPi ships a `startup-model` extension that forces `openai-codex/gpt-5.6-sol` at every process
   start because Pi persists every `/model` change as the global default. The user wants it gone:
   "disable that i mean remove that altogether. should be possible to just set the default model
   permanently."
2. The footer's model identity sits at the far right. The user wants it first: "i want model name to
   appear left, like left of the current folder. then in parens thinking level. then the folder."

## Scope

- Delete the `startup-model` package and every reference to it (root Pi manifest, live and tracked
  `settings.json`, CI check/slophammer/mutation steps, root README table, root `vitest.config.ts`
  coverage list, `slophammer.yml`, `package-lock.json`).
- Reorder the identity segment of the nyan-mode custom footer, which owns the footer line.

## Non-goals

- No attempt to stop Pi from persisting `/model` selections as the global default; Pi exposes no
  such setting. The tracked `defaultModel` (`moonshotai/Kimi-K3:fireworks-ai`) simply stays as the
  configured default.
- No change to the runway, context percentage, cost, subscription, or weekly-usage elements.
- No change to `nyan-mode` rendering modes, cat state, or commands.

## Design

### Startup model removal

The package directory is deleted. The root manifest and live settings lose the entry, then
`npm run settings:sync` regenerates the tracked file. CI, coverage, and Slophammer configuration
lose their `startup-model` lines. `npm install` refreshes the lockfile.

### Footer order

`renderFooterLine` in `packages/nyan-mode/index.ts` composes `leftFooter` and `rightFooter`. Today
the left is `π project  branch` and the right ends with `think <level> model`. The identity moves
left:

```text
<short model> (<thinking level>) π project  branch   …runway…   $cost (sub) weekly
```

- Model uses the existing `shortModel` shortening and accent color; `no-model` when absent.
- The thinking level renders as `(<level>)` in muted color, only when the model reasons — the same
  condition as today's `think <level>`, which is removed from the right side along with the model
  name.
- Cost, subscription, and weekly usage keep their place on the right.

## Acceptance criteria

- No `startup-model` references remain outside historical docs.
- The footer leads with `<model> (<thinking level>) π project  branch`; the right side no longer
  shows `think <level>` or the model name.
- Package checks and coverage thresholds pass for `nyan-mode`; root checks pass.

## Verification

- `npm run check` and `npm run slophammer` in `packages/nyan-mode`.
- Root `npx vitest run`, `npm run check`, and `git diff --check`.
- Pi Reviewer against `main`, then CI on the pull request.
