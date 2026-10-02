# Upstream record

- Repository: https://github.com/osolmaz/pi-anti-repeat
- Release: `v0.1.1`
- Commit: `f5406c3db4f201fa9e59cad731e258c662ddf92a`
- License: MIT
- Local changes: none; `index.ts` only re-exports the pinned default extension

Anti-Repeat moved out of OnurPi with its history, first as Loop Guard. The reviewed release keeps the
detection rules and thresholds of the OnurPi copy. It replaces the per-word SHA-256 hash of streamed
thinking with a rolling hash, which is 16 times faster and costs the same per word for any window
size. It is on by default, adds a policy hook and versioned events, and delivers run corrections
through `agent_before_settle`. The command is `/anti-repeat`, and the event channel and message
type are `anti-repeat`. The wrapper adds no state or runtime behavior.

Release `0.1.1` shows nothing in the footer while Anti-Repeat is only watching. The status line
appears only after a correction, a stop, or a pause.
