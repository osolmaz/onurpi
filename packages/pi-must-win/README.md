# Pi Must Win

This private OnurPi package loads a pinned Pi Must Win commit and connects its generic
child-environment attribution API to Unified Exec's pre-spawn event.

Pi Must Win remains responsible for Git trailers and hook handling. Unified Exec remains responsible
for command execution. This package contains the integration between them.

OnurPi loads this wrapper from the local checkout. It is not published to npm. Run `/reload` after
changing the package or global settings.

## Disabling per repository

Upstream Pi Must Win owns the per-repository disable feature and its config file. See the
[upstream README section](https://github.com/osolmaz/pi-must-win#disabling-per-repository). When the
session repository is disabled, this wrapper additionally skips its Unified Exec environment
subscription, so no attribution environment reaches child processes either.
