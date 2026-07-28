# @onurpi/onur-openclaw-maintainer

- Keep the workflow advisory and read-only. It must never commit, push, comment, close, create, or
  merge.
- Every run must state that it is a workflow test and that automatic merging is forbidden.
- Treat `osolmaz/onurclaw` as the curated picker source, then re-check the selected issue live.
- Keep account-specific credentials and filesystem paths out of the package.
- Use only documented Pi extension APIs and the public `pi-workflows` event contract.
- Validate issue references, inventory responses, event payloads, and model step outputs strictly.
- Keep network requests bounded, cancellable, and free of redirects.
- Add or update tests for every behavior change.
- Before finishing, run `npm run check`, `npm run slophammer`, and `git diff --check`.
- Keep mutation-testing scripts available, but run them only when explicitly requested or
  investigating test-suite strength.
