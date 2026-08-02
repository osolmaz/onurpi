import path from "node:path";

import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function regularPiAuthPath(agentDir = getAgentDir()): string {
  return path.join(agentDir, "auth.json");
}
