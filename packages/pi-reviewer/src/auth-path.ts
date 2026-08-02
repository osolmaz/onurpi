import os from "node:os";
import path from "node:path";

export function regularPiAuthPath(homeDir = os.homedir()): string {
  return path.join(homeDir, ".pi", "agent", "auth.json");
}
