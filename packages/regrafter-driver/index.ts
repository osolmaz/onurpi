/**
 * pi-regraft
 *
 * Vendor code from an upstream git repo into your project as plain files, then
 * re-pull upstream changes without losing your local edits.
 *
 * The `/regraft` command drives a deterministic core. Every pristine upstream
 * base is committed in the consumer repository; updates read the old base from
 * that local commit, fetch only the new upstream tree, and three-way merge. Git
 * does the mechanical merge. When judgment is needed, the current Pi agent gets
 * the affected files and recorded intent, then resolves them and runs tests.
 */
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  MANIFEST_FILE,
  addGraft,
  addNote,
  status,
  updateGraft,
  type UpdateResult,
} from "pi-regraft";

function manifestPath(cwd: string): string {
  return join(cwd, MANIFEST_FILE);
}

function usage(): string {
  return [
    "regraft — vendor upstream code and keep your edits across updates",
    "",
    "  /regraft add <url>[@ref][#subdir] [dest]   copy an upstream tree in and track it",
    "  /regraft update <name>                     re-pull upstream, merging your edits",
    "  /regraft status                            show which grafts are behind upstream",
    "  /regraft note <name> <text>                record why a local edit exists"
  ].join("\n");
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/** Build the message handed to the agent when an update leaves conflicts. */
function conflictBrief(result: UpdateResult): string {
  const { graft, report, previousCommit, newCommit } = result;
  const conflicts = report?.conflicts ?? [];
  const lines: string[] = [
    `regraft committed pristine upstream base ${shortSha(result.newBaseCommit!)} for "${graft.name}" (${shortSha(previousCommit)} -> ${shortSha(newCommit)}) and restored the local overlay with conflicts.`,
    "",
    `Files requiring resolution under ${graft.dest} (overlapping text edits contain <<<<<<< local / ======= / >>>>>>> upstream markers):`,
    ...conflicts.map((f) => `  - ${join(graft.dest, f)}`)
  ];
  if (graft.notes.length > 0) {
    lines.push(
      "",
      "Why these local edits exist (preserve this intent while resolving):",
      ...graft.notes.map((n) => `  - ${n}`)
    );
  }
  lines.push(
    "",
    "Resolve each conflict so the file keeps the intent above while taking the",
    "upstream changes, remove all conflict markers, then run this project's tests",
    "or checks to confirm the result before committing."
  );
  return lines.join("\n");
}

async function runAdd(pi: ExtensionAPI, ctx: ExtensionCommandContext, rest: string): Promise<void> {
  const parts = rest.trim().split(/\s+/).filter(Boolean);
  const spec = parts[0];
  if (!spec) {
    ctx.ui.notify("usage: /regraft add <url>[@ref][#subdir] [dest]", "warning");
    return;
  }
  const dest = parts[1];
  try {
    const { graft, baseCommit } = await addGraft({
      manifestPath: manifestPath(ctx.cwd),
      spec,
      ...(dest ? { dest } : {}),
    });
    ctx.ui.notify(
      `regraft: added "${graft.name}" -> ${graft.dest}; local base ${shortSha(baseCommit)}`,
      "info"
    );
    pi.sendUserMessage(
      [
        `Vendored "${graft.name}" from ${graft.source.url} (${graft.source.ref}) into ${graft.dest}.`,
        `The pristine copy and regraft.json are committed locally as ${shortSha(baseCommit)}.`,
        "",
        "Make local edits now and commit them normally. Before every update, the worktree",
        "must be clean. Regraft will read its merge base from this repository's history,",
        "not from the old upstream commit. Use",
        `\`/regraft note ${graft.name} <why>\` to record the intent behind each edit.`
      ].join("\n"),
      { deliverAs: "followUp" }
    );
  } catch (err) {
    ctx.ui.notify(`regraft add failed: ${(err as Error).message}`, "error");
  }
}

async function runUpdate(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rest: string
): Promise<void> {
  const name = rest.trim();
  if (!name) {
    ctx.ui.notify("usage: /regraft update <name>", "warning");
    return;
  }
  try {
    const result = await updateGraft(manifestPath(ctx.cwd), name);
    if (result.upToDate) {
      ctx.ui.notify(`regraft: "${name}" already at ${shortSha(result.newCommit)}`, "info");
      return;
    }
    const report = result.report!;
    if (report.conflicts.length === 0) {
      const summary = `${report.changed.length} changed, ${report.added.length} added, ${report.removed.length} removed`;
      const base = shortSha(result.newBaseCommit!);
      ctx.ui.notify(`regraft: committed local base ${base} for "${name}" (${summary})`, "info");
      pi.sendUserMessage(
        result.overlayPending
          ? `regraft committed pristine upstream base ${base} for "${name}" at ${shortSha(result.newCommit)}, then restored the merged local overlay in the worktree (${summary}). Run this project's tests or checks and commit the overlay.`
          : `regraft committed pristine upstream base ${base} for "${name}" at ${shortSha(result.newCommit)} (${summary}). There was no local overlay to restore, so the worktree is clean. Run this project's tests or checks to confirm the update.`,
        { deliverAs: "followUp" }
      );
      return;
    }
    ctx.ui.notify(
      `regraft: "${name}" updated with ${report.conflicts.length} conflict(s); handing to the agent`,
      "warning"
    );
    pi.sendUserMessage(conflictBrief(result), { deliverAs: "followUp" });
  } catch (err) {
    ctx.ui.notify(`regraft update failed: ${(err as Error).message}`, "error");
  }
}

async function runStatus(ctx: ExtensionCommandContext): Promise<void> {
  try {
    const entries = await status(manifestPath(ctx.cwd));
    if (entries.length === 0) {
      ctx.ui.notify("regraft: no grafts tracked yet", "info");
      return;
    }
    const lines = entries.map((e) => {
      const state = e.behind ? `behind (latest ${shortSha(e.latestCommit)})` : "up to date";
      return `${e.graft.name} @ ${shortSha(e.graft.commit)} (local base ${shortSha(e.localBaseCommit)}) — ${state}`;
    });
    ctx.ui.notify(`regraft status:\n${lines.join("\n")}`, "info");
  } catch (err) {
    ctx.ui.notify(`regraft status failed: ${(err as Error).message}`, "error");
  }
}

async function runNote(ctx: ExtensionCommandContext, rest: string): Promise<void> {
  const trimmed = rest.trim();
  const space = trimmed.indexOf(" ");
  if (space === -1) {
    ctx.ui.notify("usage: /regraft note <name> <text>", "warning");
    return;
  }
  const name = trimmed.slice(0, space);
  const note = trimmed.slice(space + 1).trim();
  if (!note) {
    ctx.ui.notify("usage: /regraft note <name> <text>", "warning");
    return;
  }
  try {
    const graft = await addNote(manifestPath(ctx.cwd), name, note);
    ctx.ui.notify(`regraft: recorded note for "${name}" (${graft.notes.length} total)`, "info");
  } catch (err) {
    ctx.ui.notify(`regraft note failed: ${(err as Error).message}`, "error");
  }
}

export default function extension(pi: ExtensionAPI): void {
  pi.registerCommand("regraft", {
    description: "Vendor upstream code and re-pull updates while keeping local edits",
    getArgumentCompletions: (prefix: string) => {
      const subcommands = ["add", "update", "status", "note"];
      const items = subcommands
        .filter((s) => s.startsWith(prefix))
        .map((s) => ({ value: s, label: s }));
      return items.length > 0 ? items : null;
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = (args ?? "").trim();
      const space = trimmed.indexOf(" ");
      const sub = space === -1 ? trimmed : trimmed.slice(0, space);
      const rest = space === -1 ? "" : trimmed.slice(space + 1);
      switch (sub) {
        case "add":
          await runAdd(pi, ctx, rest);
          return;
        case "update":
          await runUpdate(pi, ctx, rest);
          return;
        case "status":
          await runStatus(ctx);
          return;
        case "note":
          await runNote(ctx, rest);
          return;
        default:
          ctx.ui.notify(usage(), sub ? "warning" : "info");
      }
    }
  });
}
