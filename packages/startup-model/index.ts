import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerStartupModel } from "./startup-model.ts";

type PiModel = Parameters<ExtensionAPI["setModel"]>[0];

export default function startupModel(pi: ExtensionAPI): void {
  registerStartupModel<PiModel>({
    onSessionStart: (handler) => {
      pi.on("session_start", (event, ctx) =>
        handler(event.reason, {
          activeModel: ctx.model,
          findModel: (provider, modelId) => ctx.modelRegistry.find(provider, modelId),
          notifyError: (message) => {
            ctx.ui.notify(message, "error");
          },
        }),
      );
    },
    setModel: (model) => pi.setModel(model),
  });
}
