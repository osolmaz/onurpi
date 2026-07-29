import { getCapabilities } from "@earendil-works/pi-tui";

import { isKittyGraphicsVerified } from "./kitty-probe.ts";
import type { NyanDebugInfo } from "./types.ts";
import { assetsAvailable, DEFAULT_ASSET_DIR } from "./xpm.ts";

export function getNyanDebugInfo(assetDir = DEFAULT_ASSET_DIR): NyanDebugInfo {
  const imageProtocol = getCapabilities().images;
  return {
    supported: isKittyGraphicsVerified(),
    imageProtocol,
    assetDir,
    assetsAvailable: assetsAvailable(assetDir),
  };
}
