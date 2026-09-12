import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAgentDir,
  type AgentEndEvent,
  type ExtensionAPI,
  type InputEvent,
} from "@earendil-works/pi-coding-agent";
import { review } from "./claudishlint/index.ts";

const NUDGE_TYPE = "claudishlint.nudge";
const RESET_TYPE = "claudishlint.reset";

interface FindingGroup {
  name: string;
  description: string;
  passages: string[];
}

export default function (pi: ExtensionAPI) {
  pi.on("input", (event: InputEvent) => {
    if (event.source === "extension") {
      return;
    }
    pi.appendEntry(RESET_TYPE, true);
  });

  pi.on("agent_end", (event: AgentEndEvent, ctx) => {
    const branch = ctx.sessionManager.getBranch();
    const lastReset = branch.findLastIndex(
      (e) => e.type === "custom" && e.customType === RESET_TYPE,
    );

    const nudgedThisInteraction = branch.some(
      (e, i) => e.type === "custom" && e.customType === NUDGE_TYPE && i > lastReset,
    );
    if (nudgedThisInteraction) {
      return;
    }

    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(
        readFileSync(join(getAgentDir(), ".claudishlint.json"), "utf8"),
      ) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw err;
      }
    }

    const last = event.messages.findLast((m) => m.role === "assistant");
    if (!last) {
      return;
    }

    const { verdict, findings } = review(
      last.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
      config,
    );
    if (verdict !== "rewrite") {
      return;
    }

    const hasStyleGuide = branch.some(
      (e) => e.type === "custom" && e.customType === NUDGE_TYPE && e.data === true,
    );
    const full = !hasStyleGuide;

    pi.appendEntry(NUDGE_TYPE, full);
    pi.sendUserMessage(getPrompt(findings, full), { deliverAs: "followUp" });
  });
}

const getPrompt = (findings: FindingGroup[], full: boolean) => {
  const head =
    "Your previous response appears difficult to understand. Here is a list of probable issues with the response (detected automatically), grouped by type.";
  const findingsBlock = findings.flatMap((group) => [
    `Pattern: ${group.name}`,
    `Passages: ${group.passages.map((p) => `"${p}"`).join(", ")}`,
    `Suggestion: ${group.description}`,
    "",
  ]);
  const instruction = full
    ? [
        "Please respond with the whole response rewritten (in the same language used in the conversation) so that we can understand it more easily. Use the following style guide.",
        // Theoretically, we could use STE-100 skill here, but that might not be what
        // all users want, and we would need to support their language.
        "**Simple Language Style Guide:**",
        "Your rewrite should:",
        "- keep every fact, number, name, instruction, and degree of certainty exactly as stated",
        "- leave code blocks, inline code, paths, and identifiers untouched; rewrite only the prose",
        "- remove the patterns above and any similar ones elsewhere in the response",
        "- use plain, direct language",
        "- contain only the rewritten response (no additional acknowledgement/preamble/etc)",
      ]
    : [
        "Please respond with the whole response rewritten following the Simple Language Style Guide.",
      ];
  return [head, "", ...findingsBlock, ...instruction].join("\n");
};
