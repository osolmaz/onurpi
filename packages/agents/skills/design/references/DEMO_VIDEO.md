# Demo video

Make a short film from real product behavior or recorded experiment results.
Apply the [shared theme](THEME.md), with Yodel Grotesk for new film typography.
Preserve the source product's renderer and its assets, including their palette. Use the defaults
without routine style questions; ask when evidence or rights block correct work.

## Format and presentation

Default to 1920x1080 at 30 fps, about 90 seconds, H.264 high profile with
`yuv420p`, AAC 48 kHz stereo, and `+faststart`. Deliver the MP4 with a poster PNG of the title card. Include a caption text file. An explicit destination format overrides
these defaults.

Each storyboard card fills the frame with about 48 pixels of padding. Use one
title without a small label above it or a decorative subtitle below it. Keep the
frame free of decorative headers, footers, logo strips, and progress bars. Keep table column headers and legends. Include credits and required accessibility subtitles.
Art from the product keeps its own shading and colors.

Use full product names at first mention, including competitors. State facts
without slogans. Run every on-screen line and the caption through `plain-writing`
and `kill-ai-smell`, including the latter's checker, before rendering. Remove marketing filler and dramatic fragments. Check for repeated rhetorical
lists and em dashes as well.

## Evidence and storyboard

1. Extract evidence from immutable records with a script that makes no model
   calls. Verify the winner and score from the raw event stream. Check the turn and cost against it.
   Keep the extraction script and its JSON output in the task project.
2. Apply the project's validity rule. Exclude runs that are invalid, unfinished, or defective from every count and visual. At most, use one sentence to explain the
   exclusions. If a report conflicts with a raw record, follow the record and
   document the mismatch in the project README.
3. Write cards with start times and durations that sum to the film length. The
   first card makes a plain, evidence-backed claim such as `X does Y against Z`.
   The second gives its key number. Name the closest comparison and the position
   among alternatives within the first 15 seconds.
4. Follow with how it works, the main comparison and a real recorded moment,
   other comparisons and a complete results table. End with the summary and
   repository link. The final card adds no new information. Adapt this structure for a
   non-comparison demo without inventing comparisons or numbers.

Every animated product event must come from the event record. Do not invent an
event from a prose summary. Do not call uneven per-setting wins "even" or
"level." Show the split and use wording such as "close to" where supported.
Score tables need fixed columns for each side and a total row; never switch
score orientation down one column.

Report absolute values and counts. Use recorded cost rates and identify that basis. Note that current prices may differ. Do not claim statistical significance
or turn a small sample into a ranking. Use `practical-significance` before any
comparison supports a consequential recommendation.

## Source fidelity

Use the real product renderer and assets. Port its coordinate mapping and layer order faithfully. Preserve sizes and colors. Do not draw a replacement imitation or
remap its colors for style. Preserve real player and piece colors and include
a legend that maps them to the comparison.

Embed assets as data URIs when needed to keep canvas export origin-clean.
Record source paths and revisions with file hashes and rights. A third-party asset shipped
by a product still needs a distribution check for public video. Flag unclear
rights before delivery. No font or music asset is bundled with this skill.

Obtain Yodel Grotesk from an authorized source and verify the license. Record
font revision and hashes. Load required weights with `@font-face` and verify
them with `document.fonts.load` before rendering. Do not silently fall back. If
files are unavailable, request a source or an approved substitute.

Build one HTML page with `<canvas id="film">`, a deterministic
`window.renderFrame(t)` function, and `window.ready`, a promise that resolves
only after verified fonts and assets load. Do not depend on wall-clock time,
network races, or unseeded randomness. Every text call must enforce a maximum
width and throw on overflow. Cache static board/map layers and pre-rasterize
sprites at 2x when useful.

Set the film length with `window.FILM.duration` and its frame rate with `fps`.
Set `previewTimes` and `posterTime` as needed. Cover every card in previews and
include transitions and important motion. Set `window.fontEvidence` to the actual loaded face descriptors.

## Music

Use the user's named track only when its license permits the intended use.
Otherwise select a track from BreakingCopyright or a similar catalog with an
explicit free license. Prefer the publisher's download to a ripped stream.
Keep the license text and required credit lines beside the audio file and add
credits to the caption. Never register or fingerprint the track.

Prepare the audio bed before calling the renderer. Trim it to the film length with a short fade-in and a three-to-four-second
fade-out. Normalize speech-free background music to about -20 LUFS with a
-1.5 dBTP ceiling. Measure the result.
The renderer encodes a supplied bed; it does not license, normalize, or fade it.
If speech is present, mix and check its intelligibility separately.

## Rendering and inspection

Use `scripts/demo-video/render.mjs`, resolved from `DESIGN_DIR`, the directory
containing the loaded `SKILL.md`. Run it in the task project. Use Node 22 or newer with Chrome/Chromium and FFmpeg. Pass the installed browser explicitly
with `--chrome`; the helper does not disable its sandbox.

```sh
node "$DESIGN_DIR/scripts/demo-video/render.mjs" preview \
  --page film.html --out draft-01 --chrome "$CHROME_BIN"
node "$DESIGN_DIR/scripts/demo-video/render.mjs" poster \
  --page film.html --out draft-01 --chrome "$CHROME_BIN"
node "$DESIGN_DIR/scripts/demo-video/render.mjs" video \
  --page film.html --out draft-01 --music bed.wav --chrome "$CHROME_BIN"
```

Preview mode writes PNGs. Poster mode writes the title card. Video mode streams
sampled JPEG frames to FFmpeg. The helper refuses to replace existing outputs.
Use a new stem for each revision. Every selected frame must be inside the film.

Open every preview before a full render. Check text fit and overlaps. Compare colors and legends with the recorded product
state. Correct defects and render new previews for another inspection. Use platform-appropriate process supervision for a
long render so an attachment timeout does not kill it. Keep its log and process handle so the render can be observed and cancelled.
Wait for the completion marker and successful exit. Do not install a service or blindly use a Linux-only detach command.

Verify the final MP4 with `ffprobe` for streams, dimensions, duration, frame
count, and audio properties. Decode it completely with
`ffmpeg -v error -i OUTPUT -f null -`. Confirm the `moov` atom precedes media for
fast start. Inspect a contact sheet extracted from the encoded file, with every
card and key transition represented. Listen to the final audio. Compare output
freshness with the render log so an old file is never delivered.

## Delivery

Copy the verified MP4 to `~/Downloads` with its poster and caption using dated names.
Write a JSON receipt with SHA-256 digests and verify the delivered copies.
Preserve earlier renders and delivered files until replacements pass all checks.
Use unique log names as well; shell `noclobber` must not silently prevent a run.

Serve a temporary viewer bound only to the machine's Tailscale interface address,
with HTTP range support and a download route. Test seeking and downloading and
give the user the URL. Use a plain process with an observable handle, never a
service. If Tailscale is unavailable, report the limitation and provide local
paths instead of exposing a public or all-interface listener.

Write the project README with storyboard times, results table, cost basis,
font and asset provenance, music license, exclusions, remaining limits, and
rebuild commands. Report any unavailable visual or audio check as incomplete.
