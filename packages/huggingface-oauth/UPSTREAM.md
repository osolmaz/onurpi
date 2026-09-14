# Upstream record

- Repository: https://github.com/osolmaz/pi-huggingface-oauth
- Package: `pi-huggingface-oauth@0.2.0`
- License: MIT
- Local changes: `index.ts` wraps the pinned extension and appends the DeepSeek V4.1 Flash Fireworks
  route from `src/extra-routes.ts`, which the pinned filter drops because the router publishes no
  price for it. The appended entry copies the price, the context length, and the thinking map that
  the pinned extension uses for the other routes of the same model, and its name states that the
  price is not published.

This local entry deviates from the package rule that provider behavior changes go upstream. Onur
chose on 2026-09-14 to leave `pi-huggingface-oauth` unchanged instead of adding an option there for
unpriced live routes, so the wrapper keeps the exception until the router publishes a price for the
route or the pinned extension keeps such routes on its own.

The extension uses Pi's provider registration API, OAuth credential flow, and model catalog store.
It accesses Hugging Face's public model route catalog and Pi's normal authentication store. OnurPi
does not copy or persist credentials.
