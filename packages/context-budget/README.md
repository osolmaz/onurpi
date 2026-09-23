# @onurpi/context-budget

Every Pi request starts with a fixed block: the rendered system prompt plus the tool declarations.
That block costs the same tokens in every session, before the conversation begins, and it is easy to
grow without noticing. The measured cost of one real setup:

| Part                                                         |     Tokens |
| ------------------------------------------------------------ | ---------: |
| `AGENTS.md`, sent twice by two context-file paths            |     15,058 |
| Skill index, 65 skills                                       |      7,698 |
| Tool declarations from 29 packages                           |      5,782 |
| Pi's own prompt (preamble, tool list, guidelines, docs, cwd) |      1,081 |
| **Before the first word**                                    | **29,619** |

On a small context window that is most of the budget, and the model answers with almost no room
left. This extension measures that block, warns when it crosses a budget, and shows what the parts
cost.

## Behavior

- At session start it measures the rendered system prompt and the active tool metadata.
- Before the first turn it adds the exact context files, so each file and each duplicate shows up
  with its size.
- At the first provider request it replaces the tool estimate with the real declarations from the
  outgoing payload.
- It warns once per session when the total crosses `warnChars` or `warnTokens`. The warning lists
  the largest contributors as a borderless table: name, size, and share of the total. Parts under
  1000 characters are not named, and their sum appears as one `other` row.

  ```text
  context-budget: beginning context is 67.4K chars (~16.8K tokens), over 40.0K characters and over 10.0K tokens.
    project_context    34.8K  51.6%
    tool declarations  19.6K  29.1%
    skills              8.2K  12.2%
    other               4.8K   7.1%
    run /context-budget for the full breakdown
  ```

- The footer shows a live line, `context 118.4Kch ~29.6Ktok`, with a `!` when the budget is crossed.
- `/context-budget` prints the full breakdown: sections, context files (with duplicate content
  groups), the largest tool declarations, the config path, and current conversation use.

The extension never changes the prompt, the tool set, or the session. It only measures and reports.

## Configuration

Create `~/.pi/agent/context-budget.json`. Every key is optional, and the file is read again at each
session start or with `/context-budget reload`.

```json
{
  "enabled": true,
  "warnChars": 100000,
  "warnTokens": 24000,
  "charsPerToken": 4,
  "status": false,
  "notify": true
}
```

- `warnChars` warns when the beginning context passes this many characters.
- `warnTokens` warns on the estimated tokens. Set it to `0` to check characters only.
- `charsPerToken` converts characters to tokens for the estimate. Four is a fair default for prose
  and configuration files. The measured ratio for dense markdown with long paths is about 4.4.
- `status` controls the footer line with the measured size, and it is off by default. `notify`
  controls the startup warning.

A missing file uses these defaults. An invalid key falls back to its default and is reported, and an
unknown key is reported as a typo.

## Command

`/context-budget` shows the report and keeps it as a widget above the editor.
`/context-budget reload` re-reads the JSON file. `/context-budget clear` removes the widget.

## Limits

- The token number is an estimate from characters, not a tokenizer. Pi exposes no tokenizer for an
  arbitrary provider. The character count is exact.
- The extension measures the beginning context. Images, conversation history, and compaction belong
  to Pi and to other extensions. `@onurpi/image-budget` covers request payload size for images.
- Duplicate detection compares content hashes of loaded context files. Two files with equal content
  are both sent by Pi, so the report names them and the tokens they waste.
