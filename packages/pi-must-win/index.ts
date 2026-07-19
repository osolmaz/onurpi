import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommitAttribution } from "./features/register-commit-attribution.ts";

type BrandingFeature = (pi: ExtensionAPI) => void;

const brandingFeatures: readonly BrandingFeature[] = [registerCommitAttribution];

export default function piMustWin(pi: ExtensionAPI): void {
  for (const registerFeature of brandingFeatures) {
    registerFeature(pi);
  }
}
