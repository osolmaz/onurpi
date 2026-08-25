import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

import { isJsonObject } from "./native-checkpoint.ts";

export type CodexCompactionConfig = {
  autoCompact: boolean;
  thresholdRatio: number;
};

const DEFAULT_CONFIG: CodexCompactionConfig = {
  autoCompact: true,
  thresholdRatio: 0.9,
};

export function parseConfig(value: unknown): Partial<CodexCompactionConfig> {
  if (!isJsonObject(value)) return {};
  const autoCompact = value["autoCompact"];
  const thresholdRatio = value["thresholdRatio"];
  return {
    ...(typeof autoCompact === "boolean" ? { autoCompact } : {}),
    ...(typeof thresholdRatio === "number" && thresholdRatio > 0 && thresholdRatio < 1
      ? { thresholdRatio }
      : {}),
  };
}

function readConfig(path: string): Partial<CodexCompactionConfig> {
  if (!existsSync(path)) return {};
  try {
    return parseConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Unreadable or malformed configuration falls back to defaults.
    return {};
  }
}

export function globalConfigPath(home: string = homedir()): string {
  return join(home, CONFIG_DIR_NAME, "agent", "pi-codex-compaction.json");
}

export function projectConfigPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "pi-codex-compaction.json");
}

export function loadConfig(cwd: string, projectTrusted: boolean): CodexCompactionConfig {
  const globalConfig = readConfig(globalConfigPath());
  const projectConfig = projectTrusted ? readConfig(projectConfigPath(cwd)) : {};
  return { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };
}
