# Upstream record

- Repository: https://github.com/osolmaz/pi-must-win
- Release: `pi-must-win@0.4.0`
- Release commit: `ce609c561f30480974dfafc2dc9f8824591c922b`
- License: MIT
- Local changes: `index.ts` composes the pinned extension with OnurPi's Unified Exec environment
  event

The upstream extension adds commit trailers through a temporary Git hook, keeps its bounded GitHub
star prompt, and owns the per-repository disable config. The OnurPi adapter consults the upstream
disable predicate, then passes a copied child process environment to the upstream API before Unified
Exec spawns a command. It does not rewrite commands, persist Git configuration, or change Pi session
state.
