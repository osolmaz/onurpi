# Hugging Face OAuth

This private OnurPi package loads the pinned `pi-huggingface-oauth` extension. It adds browser login
and provider-specific Hugging Face Inference Provider routes to Pi.

The wrapper also registers one route that the pinned extension drops. The DeepSeek V4.1 Flash
Fireworks route is live and answers requests, but Hugging Face publishes no price for it, so the
pinned filter hides it. The entry lives in `src/extra-routes.ts`, and its name says that the price
is not published, because the cost it carries is the price of the other routes of the same model.

The other DeepSeek V4.1 Flash routes, including Baseten, come from the pinned refresh itself.

OnurPi loads this wrapper from the local checkout. It is not published to npm.

Run `/reload` after changing the package or global settings.
