---
name: video-editing
description: Use when editing video files with local tools, including changing playback speed while preserving audio pitch and keeping the original file unchanged.
---

# Video Editing

When editing a video, create a new output file and leave the original unchanged unless the user explicitly asks to overwrite it.

## Speed Up Video

Use FFmpeg to speed up video while preserving audio pitch:

```bash
ffmpeg -i input.mp4 -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" -map "[v]" -map "[a]" output_1.5x.mp4
```

Adjust both factors together for other speeds.
