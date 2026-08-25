import { findPackageJSON } from "node:module";
import { dirname, join } from "node:path";

export function coInstalledPiEntrypoint(baseUrl = import.meta.url): string {
  const packageJson = findPackageJSON("@earendil-works/pi-coding-agent", baseUrl);
  return packageJson ? join(dirname(packageJson), "dist", "cli.js") : "";
}
