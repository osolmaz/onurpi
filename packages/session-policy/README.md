# Session policy

Pi stores every image a tool returns as inline base64 in the session JSONL. Compaction drops the
message from the live context, but the bytes stay in the file forever. One real session reached 2.41
GB with 3,375 stored image blocks, and every one of them was older than the last compaction.

This extension keeps those bytes out of the file in the first place. It replaces each image block
with a short marker before Pi persists the tool result, keeps the picture in memory while the entry
is live, and drops the memory copy once compaction or tree navigation removes the entry. From the
session's point of view the payload is ejected at compaction.

## What the model sees

While a result is live, the `context` hook puts the cached picture back directly after its marker,
so the model still describes the image. Once the entry leaves the live context, only the marker
remains:

```text
[image-eject sha256=9f2c... mime=image/png chars=612340 source=/home/onur/shot.png]
This picture is attached while this result is in the live context. After compaction its bytes are gone. Re-read the source path to see it again.
```

The first line carries the cache key and the payload facts. The last sentence is omitted when the
tool input had no `path`.

## Load order

Load `session-policy` before `image-budget`. Pi runs hook handlers in extension load order, and
there is no per-hook priority. This extension does its own insert-time resize, so `image-budget`
sees markers instead of images at insert time and does nothing there. Its request-time budget pass
still runs after re-attach and still protects the provider request body.

## Configuration

Create `~/.pi/agent/session-policy.json`. Every key is optional, and the file is read again at each
session start or with `/session-policy reload`.

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

Sizes are bytes of base64 payload. A missing file uses these defaults. An invalid key falls back to
its default and is reported, and an unknown key is reported as a typo.

## Command

`/session-policy` prints the config path, the per-image limit and dimensions, the cache bytes and
image count, the live marker count, and the number of ejected payloads so far.
`/session-policy reload` re-reads the JSON file.

## Limits

- The cache is memory only. After `/resume`, `/reload`, or a crash, a marker that is still live has
  no picture, and the model has to read the source path again. Some sources no longer exist, so that
  read can fail. One notice per session reports this, and `notify: false` silences it.
- Cache eviction is oldest-first and never exceeds `cacheMaxBytes`. An image larger than the whole
  cache is not kept.
- Pi counts a stored image as about 1,200 tokens and a marker as about 60, so auto-compaction can
  start one tool batch later than before.
- The TUI transcript shows the marker text instead of an inline picture for ejected results.
- An extension loaded before this one still sees image blocks in `tool_result`. One loaded after
  sees markers.
- Session files that already hold image payloads are left alone. Rewriting them needs an offline
  command with no Pi process holding the file, which is a separate task.
