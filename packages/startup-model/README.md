# Startup Model

Startup Model is a Pi extension that selects one model when a Pi process starts. The OnurPi package
uses `openai-codex/gpt-5.6-sol` while leaving later model changes alone.

Changing models through `/model` or Ctrl+P affects the current process. `/reload` and session
changes within that process also keep the active model. A separately launched `pi`, including
`pi -c` or `pi -r`, selects Sol before the first prompt runs.

## Install

From the OnurPi repository root, install the local package and restart Pi:

```bash
pi install ./packages/startup-model
```

The package has no commands or settings. Change `STARTUP_MODEL` in `startup-model.ts` when OnurPi's
startup model changes, then start a new Pi process.

## Pi persistence

Pi saves every `/model`, Ctrl+P, and `pi.setModel()` selection as its global default. Pi does not
expose a setting or extension API that disables that write. Startup Model restores Sol on the next
process startup. When the saved model differs, Pi may append its ordinary model-change session entry
and rewrite the ordinary global default to Sol.

The extension adds no custom session entries or persistent data. It handles Pi's documented
`session_start` event, finds the target through the model registry, and uses the public notification
and model-selection APIs.
