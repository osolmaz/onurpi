# Hugging Face OAuth

This private OnurPi package loads the pinned `pi-huggingface-oauth` extension. It adds browser login
and provider-specific Hugging Face Inference Provider routes to Pi.

The wrapper also registers two DeepSeek V4.1 Flash routes that the pinned extension drops:
`:baseten` (Hugging Face reports `error` status while the route still serves) and `:fireworks-ai`
(no published price). Both entries live in `src/extra-routes.ts`.

OnurPi loads this wrapper from the local checkout. It is not published to npm.

Run `/reload` after changing the package or global settings.
