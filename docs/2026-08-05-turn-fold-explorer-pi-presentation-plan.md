---
title: Turn Fold explorer Pi-native presentation plan
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-08-05
---

# Turn Fold explorer Pi-native presentation plan

## Purpose

The explorer's blocks carry invented role headers, timestamps, and separate tool-call and
tool-result blocks, while Pi's transcript uses none of those. The user wants the explorer to look
like Pi.

Pi exposes no public transcript renderer, so the production-ready approach is to mirror Pi's
presentation in one module using public theme colors and Markdown, with the mirror pinned by tests
and covered by the package's existing Pi-version retest gate.

## Block model

Each entry renders as one kind-specific block with no role headers and no timestamps. Timestamps
stay only in the sticky status row.

| Entry kind         | Block                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| user               | `userMessageBg` box: bg blank, Markdown in `userMessageText`, bg blank                                                              |
| assistant          | no background; italic `thinkingText` thinking, plain Markdown text, blank between                                                   |
| tool call + result | one box: bold `toolTitle` header (`read /path`, `$ cmd`), `toolOutput` preview, muted expand hint; `toolSuccessBg` or `toolErrorBg` |
| compaction         | `customMessageBg` box with bold `[compaction]` label                                                                                |
| custom             | `customMessageBg` box with bold `[customType]` label                                                                                |

Tool pairing merges display-only: a `toolCallId → call summary` map is built lazily from entries the
viewport touches, and the result entry becomes the canonical tool block. Merged call items leave the
assistant entry's thinking and text untouched.

## Preview convention

Collapsed tools show a real preview like Pi's ctrl+o behavior: the first five visual output lines
plus a muted `... (N more lines, press o to expand)` hint. `o` expands the entry, `O` expands all
entries, matching Pi's global expand behavior. The existing detail paging keeps full output bounded.

## Boundaries

- No Pi source changes and no private component imports.
- No session entries, model context changes, or persistent state.
- Search, filters, hops, windows, virtualization, and caches are unchanged.
- Visual mirroring lives in one presentation module and is pinned by block-shape tests.

## Verification

- Unit tests for every block kind, pairing, preview counts, hint text, and backgrounds.
- Package and workspace checks, Slophammer, PTY smoke, Pi Reviewer with configured defaults, green
  CI, canonical install, live Herdr verification, and cleanup.
