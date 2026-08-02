# Upstream record

- Repository: https://github.com/osolmaz/pi-regraft
- Controller package: `pi-regraft@0.3.0`
- Extension source commit: `ed3f4cfa0d3bccca5a5ad51154ca39ade2b8f411`
- License: MIT
- Local changes: `index.ts` only re-exports the pinned source extension; the existing driver skill
  delegates to the released Regrafter CLI

The Pi extension registers the human-facing `/regraft` command. It does not add a model tool. The
Regrafter driver remains opt-in through its skill and keeps its existing repository lease and
approval boundaries.
