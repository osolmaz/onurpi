---
title: Inline usage status plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-18
---

# Inline usage status plan

## Purpose

The Nyan Mode footer shows the current `pi-usage` status on a second line. Put that status in the
main footer line after the cost and subscription labels.

The extra line appeared after `pi-usage` replaced the former Codex-only extension. `pi-usage`
publishes the stable `usage` status key, while Nyan Mode still recognizes the removed
`onurpi:codex-weekly` key.

## Requirements

- Show the current provider usage status in the main Nyan Mode footer line.
- Remove the same status from the secondary extension-status line.
- Keep unrelated extension statuses on the secondary line.
- Support every current `pi-usage` provider without parsing provider-specific status text.
- Keep the footer usable at narrow terminal widths.

## Scope

- Replace the obsolete Codex-only status identifier in Nyan Mode with the current `usage`
  identifier.
- Rename Codex-specific layout names to provider-neutral usage names.
- Update Nyan Mode tests and user documentation.

## Non-goals

- Do not change how `pi-usage` queries providers or formats status text.
- Do not move unrelated extension statuses into the main footer.
- Do not add persistent state or use Pi internals.

## Acceptance criteria

- A `usage` status such as `codex 0% wk` appears after `(sub)` on the main footer line.
- The `usage` status does not appear on the second line.
- Other extension statuses still appear on the second line.
- Existing width fitting and truncation behavior remains valid.

## Verification

- `npm --workspace @onurpi/nyan-mode run check`
- `npm --workspace @onurpi/nyan-mode run slophammer`
- `npm run check`
- `npm run slophammer`
- `git diff --check`
- Load Nyan Mode and pi-usage through Pi and confirm that the footer renders the usage status once.
