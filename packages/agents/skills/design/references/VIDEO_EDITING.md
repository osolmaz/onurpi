# Video editing

Edit existing media with explicit, repeatable operations. Preserve the original
and write to a new output path unless the user explicitly authorizes replacement.
A trim or speed change does not authorize new music, title cards, or restyling.

## Inspection and command record

Use `ffprobe` to inspect streams, duration, frame rate, rotation, sample rate,
and channel layout. Record the source hash and tool versions in the task notes. Include selected
streams and filters with the output settings. Quote paths and use FFmpeg `-n`
to refuse accidental overwrites. Keep earlier delivered outputs.

Choose stream copy when it meets the requested edit. Explain that stream-copy
trims can be limited by keyframes. For exact cuts, decode and re-encode the
necessary streams. Preserve aspect ratio and do not stretch the picture.

## Speed changes

For a video with audio, this example makes playback 1.5 times as fast while
preserving audio pitch:

```sh
ffmpeg -n -i input.mp4 \
  -filter_complex '[0:v:0]setpts=(PTS-STARTPTS)/1.5[v];[0:a:0]asetpts=PTS-STARTPTS,atempo=1.5[a]' \
  -map '[v]' -map '[a]' -c:v libx264 -pix_fmt yuv420p \
  -c:a aac -movflags +faststart output_1.5x.mp4
```

Use matching factors for audio and video. For large changes, chain `atempo`
factors within 0.5 to 2.0 and verify that their product is the requested factor.
For example, `atempo=2,atempo=2` applies a four-times speed change. Confirm the
installed FFmpeg filter support before choosing an operation.

A silent input needs a video-only command:

```sh
ffmpeg -n -i silent.mp4 -map 0:v:0 -vf 'setpts=(PTS-STARTPTS)/1.5' \
  -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart silent_1.5x.mp4
```

These examples select the first video and audio streams. Make an explicit plan
for additional tracks, subtitles, metadata, or nonzero stream offsets. Preserve
intentional synchronization offsets instead of independently resetting them.

## Verification and delivery

Check output streams and duration with `ffprobe`. A constant speed factor `s`
should produce approximately `input duration / s`; allow for frame and encoder
rounding. Decode the entire result with `ffmpeg -v error -i OUTPUT -f null -`.
Inspect the beginning, end, edit boundaries, and representative middle frames.
Listen to edited audio for pitch and synchronization. Check for clipping and artifacts.

Confirm the source hash is unchanged and the output is the new file. Deliver its
path with the operation performed and any remaining limits. Repeatable commands
with recorded versions establish reproducibility; different encoders or machines
need not produce identical bytes. If audio cannot be auditioned, report that
validation gap even when stream and decode checks pass.
