import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CO_AUTHOR_TRAILER = "Co-Authored-By";
const GENERATED_BY_TRAILER = "Generated-By";

export type CommitTrailers = {
  coAuthor: string;
  generatedBy: string;
};

export function buildCommitTrailers(modelName: string, piVersion: string): CommitTrailers {
  const safeModelName = sanitizeTrailerValue(modelName, "unknown");
  const safePiVersion = sanitizeTrailerValue(piVersion, "unknown");

  return {
    coAuthor: `${CO_AUTHOR_TRAILER}: ${safeModelName} <noreply@pi.dev>`,
    generatedBy: `${GENERATED_BY_TRAILER}: pi ${safePiVersion}`,
  };
}

/** Create a session-scoped Git hooks directory for Pi commit attribution. */
export function createCommitHookDirectory(): string {
  const hooksDirectory = mkdtempSync(join(tmpdir(), "pi-must-win-hooks-"));
  const hookPath = join(hooksDirectory, "prepare-commit-msg");
  writeFileSync(hookPath, buildPrepareCommitMessageHook());
  chmodSync(hookPath, 0o755);
  return hooksDirectory;
}

/** Remove a session-scoped Git hooks directory. */
export function removeCommitHookDirectory(hooksDirectory: string | undefined): void {
  if (hooksDirectory === undefined) return;
  rmSync(hooksDirectory, { force: true, recursive: true });
}

/** Add process-local Git hook configuration and Pi metadata to a bash command. */
export function wrapBashWithCommitAttribution(
  command: string,
  hooksDirectory: string,
  modelName: string,
  piVersion: string,
): string {
  const trailers = buildCommitTrailers(modelName, piVersion);
  return `${buildEnvironmentPrefix(hooksDirectory, trailers)}\n${command}`;
}

function sanitizeTrailerValue(value: string, fallback: string): string {
  const sanitized = value
    .replaceAll("\u0000", " ")
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || fallback;
}

function buildEnvironmentPrefix(hooksDirectory: string, trailers: CommitTrailers): string {
  return `__pi_must_win_git_config_index="\${GIT_CONFIG_COUNT:-0}"
export PI_MUST_WIN_GIT_CONFIG_INDEX="$__pi_must_win_git_config_index"
export PI_MUST_WIN_CO_AUTHOR=${shellQuote(trailers.coAuthor)}
export PI_MUST_WIN_GENERATED_BY=${shellQuote(trailers.generatedBy)}
export "GIT_CONFIG_KEY_\${__pi_must_win_git_config_index}=core.hooksPath"
export "GIT_CONFIG_VALUE_\${__pi_must_win_git_config_index}=${escapeDoubleQuotedAssignmentValue(hooksDirectory)}"
export GIT_CONFIG_COUNT="$((__pi_must_win_git_config_index + 1))"
unset __pi_must_win_git_config_index`;
}

function buildPrepareCommitMessageHook(): string {
  return `#!/bin/sh
set -eu

message_file="$1"

git \\
  -c trailer.co-authored-by.ifExists=addIfDifferent \\
  -c trailer.generated-by.ifExists=replace \\
  interpret-trailers \\
  --in-place \\
  --trailer "$PI_MUST_WIN_CO_AUTHOR" \\
  --trailer "$PI_MUST_WIN_GENERATED_BY" \\
  "$message_file"

__pi_config_index="$PI_MUST_WIN_GIT_CONFIG_INDEX"
unset "GIT_CONFIG_KEY_$__pi_config_index"
unset "GIT_CONFIG_VALUE_$__pi_config_index"
export GIT_CONFIG_COUNT="$__pi_config_index"

original_hooks_path="$(git config --get core.hooksPath || true)"
if [ -n "$original_hooks_path" ]; then
  case "$original_hooks_path" in
    /*) original_hook="$original_hooks_path/prepare-commit-msg" ;;
    *) original_hook="$(git rev-parse --show-toplevel)/$original_hooks_path/prepare-commit-msg" ;;
  esac
else
  original_hook="$(git rev-parse --git-path hooks/prepare-commit-msg)"
fi

if [ -x "$original_hook" ] && [ "$original_hook" != "$0" ]; then
  "$original_hook" "$@"
fi
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function escapeDoubleQuotedAssignmentValue(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&");
}
