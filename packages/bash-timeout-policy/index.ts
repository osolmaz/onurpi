import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { enforceBashToolCallTimeout } from "./bash-timeout-policy.ts";

export default function bashTimeoutPolicy(pi: ExtensionAPI): void {
  pi.on("tool_call", (event) => {
    enforceBashToolCallTimeout(event);
  });
}
