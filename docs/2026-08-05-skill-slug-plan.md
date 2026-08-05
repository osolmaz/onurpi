---
title: Skill slug plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-05
---

# Skill slug plan

## Purpose

Typing a skill's slug alone and pressing enter should be equivalent to calling that skill. "if i
just type a skills slug and enter, it should be equivalent to calling that skill. like in amk."
Today that requires the slash form `/skill:amk`.

## Design

Pi's documented processing order puts the `input` event before skill command expansion, and a
`transform` result continues into that expansion. The feature is therefore a rewrite, not a
re-implementation:

1. Cache the loaded skill names from `before_agent_start`'s `event.systemPromptOptions.skills`
   (ephemeral, in memory, refreshed on every agent run).
2. On `input`, when the trimmed text exactly equals a cached slug, return
   `{ action: "transform", text: "/skill:<slug>" }`. Pi's own machinery then expands the skill, so
   the result is literally identical to typing the slash form.

Deliberate choices:

- **Exact match only.** First-word matching (`amk bu nedir`) would hijack natural-language messages,
  and slugs like `amk` are real words. Arguments stay available as `/skill:slug args`.
- **Fail open on a cold cache.** The skills list is exposed at `before_agent_start`, so the very
  first message of a fresh session passes through untransformed. The model still sees the skill in
  its system prompt. The missing public capability for a warmer start is a skills accessor on
  `ExtensionContext`, which is a Pi feature request, not a workaround.

Rejected alternatives: one `registerCommand` per skill (commands need a slash, so the input hook is
still required), and self-expanding skill content via the public `loadSkills` export (re-implements
discovery and expansion, drifts from Pi).

## Scope

- New independent package `packages/skill-slug` with tests and README.
- Root registration: Pi manifest, settings sync, CI, coverage, Slophammer, mutation list, README
  table.

## Non-goals

- No argument forwarding in bare form.
- No session entries, persistence, or Pi internals. Pi produces exactly the session entries it would
  for the manually typed slash form.
- No handling of skills with `disable-model-invocation` beyond whatever Pi lists in
  `systemPromptOptions.skills`.

## Acceptance criteria

- `amk` + enter expands through Pi's skill expansion exactly like `/skill:amk`.
- Non-slug input, empty input, and multi-word input pass through unchanged.
- Package checks pass with the standard thresholds; root checks pass.

## Verification

- `npm run check` and `npm run slophammer` in `packages/skill-slug`.
- Root `npm run check`, `npm run slophammer`, `git diff --check`, and `pi list`.
- Pi Reviewer against `main`, then CI on the pull request.
