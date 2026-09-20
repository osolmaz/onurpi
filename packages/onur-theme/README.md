# Onur Theme

This package provides the `onur-dark` Pi theme used by the tracked OnurPi settings.

The theme names every Pi color token, including the optional `scrollbarTrack`, `scrollbarThumb`,
`searchMatchBg`, and `searchMatchText` tokens. Pi has fallbacks for those four, but the theme states
them so the scrollbar and the search highlight follow the palette instead of a default.

The package is loaded automatically by either the root OnurPi package or the canonical per-package
paths written by `npm run settings:reset`.
