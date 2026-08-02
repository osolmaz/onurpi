# Upstream record

- Repository: https://github.com/osolmaz/pi-must-win
- Release: `pi-must-win@0.3.0`
- Release commit: `72fedd4fe9e4ad25b5ca7f084527a8470f5eb35c`
- License: MIT
- Local changes: `index.ts` composes the pinned extension with OnurPi's Unified Exec environment
  event

The upstream extension adds commit trailers through a temporary Git hook and keeps its bounded
GitHub star prompt. The OnurPi adapter passes a copied child process environment to the upstream API
before Unified Exec spawns a command. It does not rewrite commands, persist Git configuration, or
change Pi session state.
