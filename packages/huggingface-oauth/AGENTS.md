# @onurpi/huggingface-oauth

- Keep Hugging Face OAuth pinned to an exact reviewed release.
- Keep the wrapper private and thin; make provider and OAuth behavior changes upstream.
- Never copy or expose credentials from Pi's authentication store.
- Update `UPSTREAM.md` after reviewing a new pin.
- Run `npm run check`, `npm run slophammer`, and `git diff --check` before finishing.
