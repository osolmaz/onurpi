# Sticky Prompt

- Patch only documented public Pi TUI classes and the global `@earendil-works/pi-tui/layout-node`
  symbol. Do not import Pi private modules.
- Never change the transcript height, the scroll range, or mouse coordinates. The header replaces
  one rendered content line and nothing else.
- Restore every patched prototype in the returned restore function, and only when the current value
  is still the patch this extension installed.
- Keep prompt selection and header formatting pure and tested without a terminal.
- Keep one header row per transcript, and stay silent when no prompt is above the viewport.
