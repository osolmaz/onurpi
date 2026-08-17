---
name: sanitize-png-metadata
description: Inspect PNG files for C2PA, EXIF, text, timestamp, and trailing metadata, then write sanitized copies without changing compressed image data. Use when Codex needs to check PNG provenance or privacy metadata, remove embedded PNG metadata, sanitize generated wallpapers or screenshots, or verify that PNG pixels remained unchanged.
---

# Sanitize PNG Metadata

Use the Rust `pngscrub` CLI from the tools repository:

```bash
cargo run --quiet --manifest-path ~/repos/tools/pngscrub/Cargo.toml -- inspect IMAGE.png
cargo run --quiet --manifest-path ~/repos/tools/pngscrub/Cargo.toml -- clean IMAGE.png
```

## Workflow

1. Preserve the source file. Never choose the source path as the output.
2. Run `inspect` first and report detected C2PA, signer hints, metadata chunks,
   trailing bytes, and the IDAT SHA-256.
3. Run `clean` to write the default `*.sanitized.png` copy, or pass `-o`.
4. Run `inspect` on the output and confirm the targeted metadata is absent.
5. Confirm `image_data_unchanged: yes` or compare the before/after IDAT hashes.
6. Use `--json` when machine-readable evidence is useful.

Use `--aggressive` only when the user wants unknown non-rendering ancillary
chunks removed too. The command still preserves known color, transparency,
resolution, and rendering-related chunks.

## Boundaries

- Treat this as metadata privacy cleanup, not a way to misrepresent content
  origin.
- State that C2PA/JUMBF and other PNG container metadata were removed.
- Do not claim that pixel-level signals such as SynthID were detected or
  removed. PNGScrub does not alter IDAT image data.
- Reject non-PNG inputs. For other formats, recommend a format-aware metadata
  tool such as ExifTool instead of renaming or transcoding silently.
- Keep outputs separate and do not delete originals.
