# Upstream record

- Repository: https://github.com/osolmaz/pi-anti-repeat
- Release: `v0.1.0`
- Commit: `470ef56bb593ccc9b9d85f621e4c86d6e4ce40e0`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned default extension

Anti-Repeat moved out of OnurPi with its history, first as Loop Guard. The reviewed release keeps the
detection rules and thresholds of the OnurPi copy. It replaces the per-word SHA-256 hash of streamed
thinking with a rolling hash, which is 16 times faster and costs the same per word for any window
size. It is on by default, adds a policy hook and versioned events, and delivers run corrections
through `agent_before_settle`. The command is `/anti-repeat`, and the event channel and message
type are `anti-repeat`. The wrapper adds no state or runtime behavior.
