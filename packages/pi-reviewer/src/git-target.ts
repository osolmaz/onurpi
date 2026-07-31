import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";

import type { ReviewTarget } from "./types.js";

const GIT_TIMEOUT_MS = 10_000;
const GIT_OUTPUT_LIMIT = 64 * 1024;

export type ResolvedTarget = {
  readonly cwd: string;
  readonly prompt: string;
  readonly hint: string;
};

export async function resolveTarget(
  target: ReviewTarget,
  cwd: string,
  signal?: AbortSignal,
): Promise<ResolvedTarget> {
  const canonicalCwd = await realpath(cwd);
  const root = await git(canonicalCwd, ["rev-parse", "--show-toplevel"], signal);
  const repository = await realpath(root.trim());
  switch (target.kind) {
    case "uncommitted":
      return {
        cwd: repository,
        prompt:
          "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings.",
        hint: "current changes",
      };
    case "base":
      return await resolveBase(repository, target.branch, signal);
    case "commit":
      return await resolveCommit(repository, target.sha, target.title, signal);
    case "custom":
      return {
        cwd: repository,
        prompt: target.instructions.trim(),
        hint: target.instructions.trim(),
      };
  }
}

async function resolveBase(
  cwd: string,
  branch: string,
  signal?: AbortSignal,
): Promise<ResolvedTarget> {
  if (branch.startsWith("-") || branch.length > 1024) throw new Error("invalid base branch");
  await git(cwd, ["check-ref-format", "--branch", branch], signal);
  const mergeBase = (await git(cwd, ["merge-base", "HEAD", branch], signal, true)).trim();
  const prompt =
    mergeBase === ""
      ? `Review the code changes against the base branch '${branch}'. Start by finding the merge diff between the current branch and ${branch}'s upstream e.g. (\`git merge-base HEAD "$(git rev-parse --abbrev-ref "${branch}@{upstream}")"\`), then run \`git diff\` against that SHA to see what changes we would merge into the ${branch} branch. Provide prioritized, actionable findings.`
      : `Review the code changes against the base branch '${branch}'. The merge base commit for this comparison is ${mergeBase}. Run \`git diff ${mergeBase}\` to inspect the changes relative to ${branch}. Provide prioritized, actionable findings.`;
  return { cwd, prompt, hint: `changes against '${branch}'` };
}

async function resolveCommit(
  cwd: string,
  sha: string,
  suppliedTitle: string | undefined,
  signal?: AbortSignal,
): Promise<ResolvedTarget> {
  if (sha.length > 256) throw new Error("commit value is too long");
  const resolved = (
    await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`], signal)
  ).trim();
  const title =
    suppliedTitle ??
    (await git(cwd, ["show", "-s", "--format=%s", "--no-patch", resolved], signal)).trim();
  const prompt =
    title === ""
      ? `Review the code changes introduced by commit ${resolved}. Provide prioritized, actionable findings.`
      : `Review the code changes introduced by commit ${resolved} ("${title}"). Provide prioritized, actionable findings.`;
  return { cwd, prompt, hint: `commit ${resolved.slice(0, 7)}${title === "" ? "" : `: ${title}`}` };
}

async function git(
  cwd: string,
  args: readonly string[],
  signal?: AbortSignal,
  acceptCodeOne = false,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    const timer = setTimeout(() => child.kill("SIGTERM"), GIT_TIMEOUT_MS);
    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= GIT_OUTPUT_LIMIT) stdout.push(chunk);
      else child.kill("SIGTERM");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= GIT_OUTPUT_LIMIT) stderr.push(chunk);
      else child.kill("SIGTERM");
    });
    child.on("error", reject);
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const failure = gitFailure({
        code,
        terminationSignal,
        aborted: signal?.aborted === true,
        oversized: bytes > GIT_OUTPUT_LIMIT,
        acceptCodeOne,
        errorText: Buffer.concat(stderr).toString("utf8").trim(),
      });
      if (failure === undefined) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(failure);
    });
  });
}

type GitFailureInput = {
  readonly code: number | null;
  readonly terminationSignal: NodeJS.Signals | null;
  readonly aborted: boolean;
  readonly oversized: boolean;
  readonly acceptCodeOne: boolean;
  readonly errorText: string;
};

function gitFailure(input: GitFailureInput): Error | undefined {
  if (input.aborted) return new Error("Git command cancelled");
  if (input.oversized) return new Error("Git command output exceeded limit");
  if (input.terminationSignal !== null) return new Error("Git command timed out");
  if (input.code === 0 || (input.acceptCodeOne && input.code === 1)) return undefined;
  return new Error(input.errorText === "" ? "Git command failed" : input.errorText);
}
