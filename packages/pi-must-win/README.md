# Pi Must Win

This private OnurPi package loads a pinned Pi Must Win commit and connects its generic
child-environment attribution API to Unified Exec's pre-spawn event.

Pi Must Win remains responsible for Git trailers and hook handling. Unified Exec remains responsible
for command execution. This package contains the integration between them.

OnurPi loads this wrapper from the local checkout. It is not published to npm. Run `/reload` after
changing the package or global settings.
