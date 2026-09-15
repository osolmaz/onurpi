---
name: demo-video
description: Use when asked to create a demo, showcase, teaser, or results video for social media or a talk from a product, simulator, benchmark, or experiment. Covers evidence extraction, storyboard, a light full-screen design in the user's font, a faithful port of the product's own renderer and assets, headless Chrome rendering to MP4, licensed background music, copy checks, and delivery with a temporary viewer link.
---

# Demo video

Make a short video that shows real recorded results of a product or experiment, for X, YouTube, or
a talk. The output is one MP4 the user can post as is. Do the whole job in one pass with the
defaults below. Do not ask about background color, font, layout, or structure. Ask only when the
evidence itself is ambiguous or when a license would block posting.

## Defaults that are already decided

Apply all of these unless the user says otherwise in the current request.

Format:

- 1920x1080, 30 fps, H.264 `yuv420p` high profile, AAC 48 kHz stereo, `+faststart`, about 90 s.
- One deliverable MP4, one poster PNG (the title card), and one caption text file.

Design:

- Light, solid background. No gradients, shadows, or glow anywhere in the page design. Art files
  from the product keep their own shading.
- No header, no footer, no logo strip, no progress bar, no section labels. Every card fills the
  frame with about 48 px of padding.
- No subtitle line under a heading. No small uppercase label above a heading. If a fact matters,
  put it in the heading or in body text. Column headers inside a table are fine.
- Body copy states facts. No slogans, no marketing lines.
- Font: the user's font, Yodel Grotesk from the public GitHub repository `horsefit/yodel-grotesk`
  (Regular, Bold, Black). Clone or download it, record the commit and file hashes, load it with
  `@font-face`, and verify with `document.fonts.load` before rendering a frame. Never fall back to
  a system font silently.
- Palette from the content. Sample the product's own visuals: its board, map, UI, or chart colors.
  Pick one accent for the subject, one for the comparison, a deep ink, and a background tinted like
  the product's light surfaces. Do not invent an unrelated brand palette.
- Full product names on screen, for example `DeepSeek V4.1 Flash`, not a nickname. The first
  mention of any competitor uses its full name too.

Visuals:

- Use the product's real renderer and real assets. Port the app's own drawing code faithfully:
  same coordinate mapping, layer order, sizes, colors, and asset files. Never draw an imitation of
  the product's visuals from scratch, and never remap its colors for style.
- Embed assets as data URIs so canvas export is never tainted, and record provenance (source path,
  commit, hashes).
- Real piece and player colors on screen, with a legend that maps them to the things the video
  compares.
- Every animated moment comes from the recorded event log, not from a prose report. If a report and
  the raw record disagree, follow the record and note it in the project README.

Content:

- Show only valid results. Exclude invalid, unfinished, or defective runs from every count and every
  visual. Mention them at most in one sentence that explains what was left out and why.
- Lead with the main point. The first card is a plain title of the form `X does Y against Z`. The
  second card states the main claim with the key number. Name the closest comparison early, and
  give the position relative to the alternatives, for example "above A, close to B, below C".
- Do not call a split record "level" or "even" when the wins are uneven across settings, for
  example when the subject only won while the comparison ran at a setting where it struggled.
  Say "close to" and show the per-setting split on the comparison card.
- Score tables use one fixed column per side, for example a DeepSeek column and a Terra column,
  plus a total row. Never write scores as "A 2–0", "1–1", "B 3–1" down one column, because the
  orientation flips per row and the reader cannot add them up.
- Order the rest as: how it works in one card, the main comparison with a real moment from the
  record, the other comparisons, a complete results table, a summary that repeats the claim, the
  repository link. Keep the last card free of new information.
- Costs and prices: use the rates recorded in the runs, say so, and add one line that current prices
  may differ. Report absolute values and counts. Do not claim statistical significance, and do not
  call the result a ranking when the sample is small.

Audio:

- Use the royalty-free track the user names. If none is named, pick one from BreakingCopyright or a
  similar catalog with an explicit free license. Prefer the publisher's official download link over
  ripping the stream. Save the license text and the required credit lines next to the file, put the
  credits in the caption, and never register or fingerprint the track.
- Trim to the video length with a short fade in and a 3 to 4 s fade out. Normalize to about
  -20 LUFS with a -1.5 dBTP ceiling so speech-free background music does not dominate.

Copy:

- Run every on-screen line and the caption through the `kill-ai-smell` and `plain-writing`
  skills before rendering. Remove slogans, tricolons, sentence fragments used for drama, and
  em dashes.

Delivery:

- Copy the MP4, poster, and caption to `~/Downloads` with a dated name and write a JSON receipt
  with SHA-256 digests.
- Serve a temporary viewer on the machine's Tailscale interface address only, with HTTP range
  support and a download route. Use a plain process, not a service. Give the user the URL.
- Keep every earlier render on disk under a different name. Never overwrite a delivered file until
  the replacement passed the checks below.

## Workflow

1. Extract evidence from the immutable records with a script that makes no model calls. Verify
   each result from the raw event stream (winner, score, turn, cost) and keep the extraction script
   and its JSON output in the project folder. Reject anything not marked valid by the project's own
   validity rule.
2. Write the storyboard as a list of cards with start times that sum to the total length. Put the
   claim, the closest comparison, and the position among alternatives in the first 15 s.
3. Build the film as one HTML page with a 1920x1080 canvas and one deterministic
   `window.renderFrame(t)` function, plus `window.ready` that resolves after fonts and assets load.
   Every text call passes a maximum width, and the render throws when a line exceeds it, so an
   overflow fails the render instead of clipping on screen.
4. Port the product renderer into the page as described above. Cache static layers (board, map)
   per position and pre-rasterize sprites at 2x.
5. Render with the script in `reference/render.mjs`: `preview` writes one PNG per storyboard card,
   `poster` writes the title card, `video` streams JPEG frames to FFmpeg with the music bed.
6. Look at every preview frame. Check for overlaps, clipped text, and wrong colors before the full
   render. Fix, re-render previews, look again.
7. Run the full render detached, for example with `setsid nohup ... &`, so a shell timeout or a
   harness signal cannot kill it. Wait for a done marker in the log.
8. Verify the output: `ffprobe` for stream properties and frame count, `ffmpeg -f null -` full
   decode, `moov` near the start for fast start, and a contact sheet with one frame from each card.
   Compare the file timestamp with the render log so a stale file is never delivered.
9. Deliver as described above, then write or update the project README: structure with times,
   results table, cost basis, asset and font provenance, music license, limits, and the rebuild
   commands.

## Pitfalls seen in practice

- In zsh, `>` refuses to overwrite an existing file when `noclobber` is set, and the command after
  it silently does not run. Use `>|` or delete the old log first, and confirm the output timestamp.
- Long renders have been killed about a minute in when run inside an agent shell. Detach them.
- SVG assets loaded from `file://` can taint the canvas and break `toDataURL`. Embed them as data
  URIs.
- Column headers such as "Victory points" may stay. Everything else that looks like a small caption
  goes.
- A third-party asset set, even one the product already ships, is a distribution question for a
  public video. Record the source and say so in the README so the user can decide.
