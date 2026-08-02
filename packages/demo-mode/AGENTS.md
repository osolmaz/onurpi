# @onurpi/demo-mode

- Keep Pi Demo Mode pinned to an immutable upstream commit.
- Keep the wrapper private and thin; make behavior changes upstream.
- Preserve `PI_DEMO_MODE=1` as the explicit activation boundary.
- Update `UPSTREAM.md` after reviewing a new pin.
- Run `npm run check`, `npm run slophammer`, and `git diff --check` before finishing.
