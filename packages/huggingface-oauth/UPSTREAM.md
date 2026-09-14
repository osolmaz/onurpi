# Upstream record

- Repository: https://github.com/osolmaz/pi-huggingface-oauth
- Package: `pi-huggingface-oauth@0.2.0`
- License: MIT
- Local changes: `index.ts` wraps the pinned extension and appends the routes in
  `src/extra-routes.ts`

The extension uses Pi's provider registration API, OAuth credential flow, and model catalog store.
It accesses Hugging Face's public model route catalog and Pi's normal authentication store. OnurPi
does not copy or persist credentials.
