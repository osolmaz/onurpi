# Upstream record

- Repository: https://github.com/osolmaz/pi-regraft
- Release: `pi-regraft@0.4.0`
- Release commit: `4a2297b9f932cf758306beb919f014d68b2e01be`
- License: MIT
- Local changes: `index.ts` only re-exports the released source extension; the existing driver skill
  delegates to the bundled Regrafter CLI

The Pi extension registers the human-facing `/regraft` command. It does not add a model tool. The
Regrafter driver remains opt-in through its skill and keeps its existing repository lease and
approval boundaries.
