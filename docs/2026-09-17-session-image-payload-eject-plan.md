---
title: Eject stored image payloads after compaction
author: Onur Solmaz <2453968+osolmaz@users.noreply.github.com>
date: 2026-09-17
tags: [pi, session-policy, images, compaction, extensions]
---

# Eject stored image payloads after compaction

## Purpose

A Pi session stores every image a tool returns as inline base64 inside the session JSONL. Those
bytes are never removed, even after compaction drops the message from the live context. One real
session proves the size of the problem:

- `~/.pi/agent/sessions/--home-onur-repos-workouts--/2026-08-28T16-23-00-268Z_01a0492e-…jsonl` is
  2.41 GB across 46,400 lines.
- 3,375 tool-result image blocks hold 2,285,170,740 base64 characters, which is 2,179 MB.
- Pi's own loader reports 0 images in the live context and 3,375 images in the file, because the
  last compaction sits at line 46,241 of 46,400 and every image is older than it.

The end state Onur asked for: once a session compacts, images from pre-compaction messages must no
longer hold their image payloads in the session, and the session must stay loadable and resumable.

Pi cannot do this today. The `SessionManager` write API is append-only
(`docs/session-format.md:406-414`), `ctx.sessionManager` is documented as read-only
(`docs/extensions.md:1000-1011`), and the only whole-file writer is the private `_rewriteFile`,
which runs only for version migration and branch creation
(`dist/core/session-manager.js:632, 677, 1173`). A stored entry cannot be redacted after the fact
through any documented path.

So the new extension must prevent the bytes from entering the file in the first place, keep the
picture visible to the model while the entry is live, and drop its in-memory copy as soon as
compaction removes the entry from the live context. From the session's point of view the payload is
ejected at compaction.

## Selected design

A new package `packages/session-policy` (`@onurpi/session-policy`) implements one rule: image
content. The mechanism is content-type agnostic on purpose, so a later text rule can reuse it, but
this plan ships the image rule only.

### Insert time: capture, resize, mark

Hook: `tool_result` (`docs/extensions.md:842-874`), which fires before Pi finalizes the result and
may return modified `content`.

For every image block in the result:

1. If the base64 payload is over `maxImageBytes`, re-encode it with `resizeImage` (exported from the
   package root at `dist/index.d.ts:33`) at `maxImageWidth` x `maxImageHeight`.
2. Key the block by `sha256` of its base64 payload and store it in the session's in-memory cache.
   The cache is bounded by `cacheMaxBytes` and evicts oldest first.
3. Replace the image block, in place, with one text block that holds two lines:

   ```text
   [image-eject sha256=<64 hex> mime=image/png chars=612340 source=/abs/path.png]
   This picture is attached while this result is in the live context. After compaction its bytes are gone. Re-read the source path to see it again.
   ```

   `source` comes from `event.input.path` when the tool input has one, and is omitted otherwise.

Return `{ content }` only when the result changed. Pi persists the returned content, so the session
stores the marker and never the payload.

### Request time: re-attach while live

Hook: `context` (`docs/extensions.md:675-685`), which receives a deep copy of the live messages and
uses the returned array only for the model call.

For every tool-result message, find marker blocks whose `sha256` is still in the cache and insert
the cached image block directly after the marker. Return `{ messages }` only when something was
re-attached. Never mutate the incoming array.

This is what keeps the picture visible while the entry is live. If `images.blockImages` is on, Pi
replaces the re-attached image with its own placeholder, so both features compose.

### Compaction and tree navigation: eject

Hooks: `session_compact` (`docs/extensions.md:452-492`) and `session_tree`.

On each event, call `ctx.sessionManager.buildContextEntries()`, collect the `sha256` values of every
marker still present in the live entries, and delete every cache entry whose hash is not in that
set. This is an in-memory set difference, so it does not delay the overflow retry that Pi runs right
after the handler resolves (`dist/core/agent-session.js:1851-1861`).

`session_start` resets the state and reads the config. `session_shutdown` clears the cache. Neither
writes anything.

### Marker format

One text block, first line machine-parseable:

```text
^\[image-eject sha256=([0-9a-f]{64}) mime=(\S+) chars=(\d+)(?: source=(\S.*))?\]$
```

A marker whose hash is missing from the cache passes through `context` unchanged and produces no
error and at most one notice per session.

### Configuration and command

Config file `~/.pi/agent/session-policy.json`, all keys optional, re-read at session start and with
`/session-policy reload`:

```json
{
  "enabled": true,
  "maxImageBytes": 409600,
  "maxImageWidth": 1600,
  "maxImageHeight": 1600,
  "cacheMaxBytes": 67108864,
  "notify": true
}
```

An unknown key is reported as a typo; an invalid value falls back to its default and is reported.

`/session-policy` prints the config path, the limits, cache bytes, cached image count, live marker
count, and the number of ejected images so far.

### Load order

The package README must state that `session-policy` loads before `image-budget`. Pi has no per-hook
priority; handler order is extension load order (`docs/extensions.md:849`). Because `session-policy`
performs its own insert-time resize, `image-budget` sees markers instead of images at insert and
does nothing there, while its request-time budget pass still runs after re-attach and still protects
the provider request body.

## Package layout

Follow `docs/adding-packages.md`:

```text
packages/session-policy/
├── package.json        # private, @onurpi/session-policy, pi.extensions: ["./index.ts"]
├── index.ts            # hook wiring only
├── config.ts           # config read and validation
├── marker.ts           # marker build, parse, and match
├── cache.ts            # bounded hash-keyed image cache
├── policy.ts           # pure insert-time, re-attach, and prune functions
├── command.ts          # /session-policy
├── README.md           # user behavior, config, load-order rule, limits
└── *.test.ts           # per-module tests
```

Register `./packages/session-policy/index.ts` in the root `package.json` `pi.extensions` list, and
run `npm run settings:sync` so local development settings stay canonical. Do not hand-edit
`settings.json`.

Keep policy functions pure and separate from Pi hooks, so the rules are unit-testable without a Pi
runtime. Do not add runtime dependencies; `resizeImage` comes from Pi.

## Out of scope

- Rewriting session files that already hold image payloads, including the 2.41 GB session above.
  That needs an offline command with no Pi process holding the file, and it is a separate task.
- Changing `@onurpi/image-budget` behavior, config, README contract, or ordering internals.
- A disk spool or sidecar image store. The design intentionally keeps the cache in process memory.
- Pruning content classes other than images.

## Risks and expected symptoms

- After `/resume`, `/reload`, or a crash, the cache is empty, so a live marker has no picture and
  the model re-reads the source path. 158 of the 3,375 sources in the example session no longer
  exist, so some re-reads fail. One notice per session explains this.
- Pi counts a stored image as 1,200 tokens and a marker as about 60
  (`dist/core/compaction/compaction.js:168-183`), so auto-compaction can start one tool batch later
  than before.
- The TUI transcript shows the marker text instead of an inline picture for ejected results.
- An extension loaded before this one still sees image blocks in `tool_result`; one loaded after
  sees markers. The README states the order requirement.

## Verification

Local checks, run from the repository root:

```bash
npm run check
npm run slophammer
git diff --check
```

Unit and integration tests:

- Pass-through: a text-only result and a `context` event with no markers both return `undefined`.
- Insert: a result with two images yields two markers with the correct hash, mime, char count, and
  `source`; both images are cached; a tool input without `path` omits `source`.
- Oversize image: a payload over `maxImageBytes` is resized before caching, and the marker reports
  the resized char count.
- Re-attach: a live marker with a cached hash returns the message with the image after the marker,
  and the input array is not mutated.
- Compaction keeps: after `session_compact`, a marker still inside `firstKeptEntryId` or later keeps
  its cache entry and still re-attaches.
- Compaction drops: a marker older than `firstKeptEntryId` loses its cache entry, and the next
  `context` call returns the marker only.
- Tree navigation evicts hashes no longer referenced by the live branch.
- Missing cache: pass-through, no exception, one notice per session.
- Duplicate prevention: a marker-only result returns `undefined`; identical payloads share one cache
  entry; a marker that already has the image after it is not given a second one.
- Cache bound: eviction is oldest-first and never exceeds `cacheMaxBytes`.

End-to-end smoke test with a real Pi process, using the development entry point:

1. Start `pi -e ./packages/session-policy/index.ts` in a scratch directory.
2. Ask it to read a PNG file.
3. Confirm the transcript shows the marker and the stored entry has no image block, while the model
   still describes the picture.
4. Run `/compact`.
5. Open the session file with `SessionManager.open` and confirm zero image blocks and that
   `buildContextEntries()` yields the expected live entry ids.
6. Run `/session-policy` and confirm the cache is empty after compaction.

State explicitly in the final report what could not be tested locally.
