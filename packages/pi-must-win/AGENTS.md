# @onurpi/pi-must-win

- Keep Pi Must Win pinned to an exact reviewed release and record its immutable release commit in
  `UPSTREAM.md`.
- Keep command-executor integration in this composition package; do not couple either upstream
  package to the other.
- Pass attribution through child process environments and preserve existing Git hooks.
- Update `UPSTREAM.md` after reviewing a new pin.
- Run `npm run check`, `npm run slophammer`, and `git diff --check` before finishing.
