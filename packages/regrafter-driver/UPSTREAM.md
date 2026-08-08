# Upstream record

- Repository: https://github.com/osolmaz/pi-regraft
- Release: `pi-regraft@0.5.1`
- Release commit: `19873afc1a4b9d38a566dfa8df6aff472ba05e44`
- License: MIT
- Local changes: `index.ts` only re-exports the released source extension; the existing driver skill
  delegates to the bundled Regrafter CLI

The Pi extension registers the human-facing `/regraft` command. It does not add a model tool. The
Regrafter driver remains opt-in through its skill and keeps its existing repository lease and
approval boundaries.
