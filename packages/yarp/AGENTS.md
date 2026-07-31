# @onurpi/yarp

- Keep the upstream YARP source pinned to an immutable commit.
- Review upstream changes before updating the pin and refresh `UPSTREAM.md`.
- Keep this package as a thin re-export; make behavior changes in the upstream repository.
- Require the matching `yarp` binary on `PATH` and fail open when it is unavailable.
- Use only Pi's documented public APIs. Do not change session state, persistent data, or Pi
  internals.
- Add or update tests for every integration change.
- Before finishing, run `npm run check`, `npm run slophammer`, and `git diff --check`.
- Keep mutation-testing scripts available, but run them only when explicitly requested or when
  investigating test-suite strength.
