# Upstream record

- Repository: https://github.com/osolmaz/pi-must-win
- Release: `pi-must-win@0.5.0`
- Release commit: `0753772dd04a38b19a098c35eff07027b28a2f79`
- License: MIT
- Local changes: `index.ts` composes the pinned extension with OnurPi's Unified Exec environment
  event

The upstream extension adds commit trailers through a temporary Git hook, keeps its bounded GitHub
star prompt, and owns the per-repository disable config, which it now also evaluates inside the
commit hook for the repository actually being committed to. The OnurPi adapter consults the upstream
disable predicate, then passes a copied child process environment to the upstream API before Unified
Exec spawns a command. It does not rewrite commands, persist Git configuration, or change Pi session
state.
