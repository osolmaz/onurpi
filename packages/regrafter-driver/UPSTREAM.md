# Upstream record

- Repository: https://github.com/osolmaz/pi-regraft
- Package: `pi-regraft@0.3.0`
- License: MIT
- Local changes: `index.ts` carries the upstream Pi extension entry point with package imports; the
  existing driver skill delegates to the upstream Regrafter CLI

The Pi extension registers the human-facing `/regraft` command. Its implementation is copied from
the pinned source and imports Regraft operations through the package's public root export. It does
not add a model tool. The Regrafter driver remains opt-in through its skill and keeps its existing
repository lease and approval boundaries.
