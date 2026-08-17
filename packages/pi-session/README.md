# pi-session

pi-session is a standalone, read-only CLI for Pi session files. It gives people and agents a bounded
view of the active branch without copying full tool results, images, reasoning, or signatures into
the output.

## Install from this workspace

```bash
npm install
npm run build --workspace @onurpi/pi-session
npm link --workspace @onurpi/pi-session
```

The package is private and is not a Pi extension or another Pi resource.

## Use it

Show the last 20 turns from a session in the current project:

```bash
pi-session 019fd7b1
```

You can also give an absolute JSONL path:

```bash
pi-session /absolute/path/to/session.jsonl
```

Select output and control evidence:

```bash
pi-session 019fd7b1 --last 5 --assistant text
pi-session 019fd7b1 --include workflow,plan,errors,files --format json
pi-session 019fd7b1 --since 2026-08-18T12:00:00Z
```

Session UUID lookup stays in the current working directory by default. Use `--all-projects` only
when you need broader discovery.

List sessions or inspect one bounded entry:

```bash
pi-session list --limit 10
pi-session entry 019fd7b1 a1b2c3d4 --format json
```

## JSON output

JSON output uses the `pi-session/v1` schema. Recovery output has stable `session`, `integrity`,
`selection`, `turns`, and `nextOffset` fields. `nextOffset` is the number of older active-branch
turns omitted from the view, or `null` when none were omitted. Omission counts cover turns, control
events, integrity issues, list results, and bytes removed from excerpts.

Normal excerpts are limited to 2 KiB. Workflow and plan excerpts are limited to 8 KiB. Complete text
and JSON output is limited to 40 KiB. Likely credentials are redacted, and image, binary, base64,
signature, custom metadata, and raw tool-result bodies are omitted.

pi-session does not infer the task state or a next action. It reports session evidence only. It does
not open legacy sessions because Pi would migrate and rewrite them.
