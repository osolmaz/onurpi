# @onurpi/image-budget

Pi limits how much text a tool may return, but nothing limits images. Every screenshot a tool
returns stays in the retained context and is resent on every request. A vision-heavy session can
therefore grow past a provider's request-body limit. The Hugging Face router rejects any body over 5
MiB with `413 request entity too large`, before the model runs, so every later turn fails and the
conversation is stuck.

This extension keeps image bytes inside a budget. It re-encodes large screenshots as they arrive,
and it replaces the oldest images with a text note when a request would otherwise grow too large.

## Behavior

- A tool result keeps at most 4 images. Extra images become a text note.
- An image over 400 KB becomes a JPEG or PNG under 400 KB, at most 1600x1600.
- Before each model call, images over 3.5 MB become text notes, oldest first. The newest image is
  redacted only when nothing else frees enough room.
- Redaction aims for 2.5 MB, not 3.5 MB, so the next few screenshots do not trigger another pass and
  invalidate the prompt cache again.
- The model sees a note in place of every redacted image, with the byte size, the source tool, and
  the number of images kept.
- The extension adds nothing to the Pi status line. It writes one line in the terminal when it
  changes images, and `/image-budget` reports the current load on demand.

Session files stay complete: request-time redaction happens on the copy Pi hands to the `context`
hook and is never written to the transcript. Insert-time re-encoding does change the stored tool
result, because that is where the growth starts.

## Configuration

Create `~/.pi/agent/image-budget.json`. Every key is optional, and the file is read again at each
session start or with `/image-budget reload`.

```json
{
  "enabled": true,
  "maxImageBytes": 409600,
  "maxImageWidth": 1600,
  "maxImageHeight": 1600,
  "maxImagesPerResult": 4,
  "imageBudgetBytes": 3670016,
  "redactToBytes": 2621440,
  "notify": true
}
```

Sizes are bytes of base64 payload, which is what dominates a request body. Set `imageBudgetBytes`
below your provider's body limit, and leave room for text, tool definitions, and the system prompt:
about 0.7 MB in a long session. A missing file uses these defaults. An invalid key falls back to its
default and is reported, and an unknown key is reported as a typo.

## Command

`/image-budget` prints the config path, the limits, the current image load, and what the extension
changed so far. `/image-budget reload` re-reads the JSON file.

## Limits

- The budget is a setting, not a discovered provider limit. Pi exposes no field for a provider's
  maximum request body size, so a provider with a different limit needs its own `imageBudgetBytes`.
- Pi compaction still counts one image as about 1,200 tokens, so it will not trigger on image bytes.
  This extension covers that gap for images only. For a fully first-class fix, Pi would need a
  numeric image byte budget in `images` settings and image bytes counted in the compaction trigger.
- Redaction rewrites the outgoing request, so the affected part of the prompt cache is rebuilt. The
  low-water target limits how often that happens.
