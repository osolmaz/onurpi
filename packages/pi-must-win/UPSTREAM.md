# Upstream record

- Repository: https://github.com/osolmaz/pi-must-win
- Commit: `8721f01745987736837b135a912c5ebdae5d75b2`
- Base release: `0.2.0`
- License: MIT
- Local changes: `index.ts` composes the pinned extension with OnurPi's Unified Exec environment
  event

The upstream extension adds commit trailers through a temporary Git hook and keeps its bounded
GitHub star prompt. The OnurPi adapter passes a copied child process environment to the upstream API
before Unified Exec spawns a command. It does not rewrite commands, persist Git configuration, or
change Pi session state.
