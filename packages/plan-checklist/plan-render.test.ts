import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";

import {
  fallbackToolText,
  PlanWidget,
  renderPlanCall,
  renderPlanResult,
  renderPlanWidgetLines,
} from "./plan-render.ts";
import { decodePlanSnapshot, type PlanSnapshot } from "./plan-schema.ts";

const theme: Pick<Theme, "bold" | "fg" | "italic" | "strikethrough"> = {
  bold: (text) => `\u001b[1m${text}\u001b[22m`,
  fg: (_color, text) => `\u001b[36m${text}\u001b[39m`,
  italic: (text) => `\u001b[3m${text}\u001b[23m`,
  strikethrough: (text) => `\u001b[9m${text}\u001b[29m`,
};

function snapshot(): PlanSnapshot {
  const decoded = decodePlanSnapshot({
    plan: [
      { step: "Inspect the existing implementation", status: "completed" },
      { step: "Implement the complete plan checklist behavior", status: "in_progress" },
      { step: "Run all package and workspace checks", status: "pending" },
    ],
  });
  if (!decoded) throw new Error("Expected valid fixture");
  return decoded;
}

describe("transcript rendering", () => {
  it("renders the title, trimmed explanation, and full expanded plan within width", () => {
    const call = renderPlanCall("  Scope changed  ", theme).render(18);
    const result = renderPlanResult(snapshot(), true, theme).render(22);

    expect(call.join("\n")).toContain("Updated Plan");
    expect(call.join("\n")).toContain("Scope changed");
    expect(result.join("\n")).toContain("1/3 completed");
    expect(result.join("\n")).toContain("Inspect");
    expect(result.join("\n")).toContain("Implement");
    expect(result.join("\n")).toContain("Run all");
    for (const line of [...call, ...result]) expect(visibleWidth(line)).toBeLessThanOrEqual(22);
  });

  it("keeps collapsed output compact and handles empty plans", () => {
    const collapsed = renderPlanResult(snapshot(), false, theme).render(80).join("\n");
    const empty = decodePlanSnapshot({ plan: [] });
    if (!empty) throw new Error("Expected empty fixture");

    expect(collapsed).toContain("Implement the complete plan checklist behavior");
    expect(collapsed).toContain("2 other steps");
    expect(collapsed).not.toContain("Run all package");
    expect(renderPlanResult(empty, true, theme).render(80).join("\n")).toContain(
      "(no steps provided)",
    );
  });

  it("extracts fallback text from malformed tool output", () => {
    expect(fallbackToolText([{ type: "image" }, { type: "text", text: "raw result" }])).toBe(
      "raw result",
    );
    expect(fallbackToolText([{ type: "image" }])).toBe("");
  });
});

describe("current plan widget", () => {
  it("bounds long plans and every rendered line", () => {
    const long = decodePlanSnapshot({
      plan: Array.from({ length: 10 }, (_, index) => ({
        step: `Step ${String(index + 1)} with a deliberately long description`,
        status: index === 6 ? "in_progress" : index < 6 ? "completed" : "pending",
      })),
    });
    if (!long) throw new Error("Expected long fixture");

    const lines = renderPlanWidgetLines(long, 24, theme);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain("Plan 6/10");
    expect(lines.join("\n")).toContain("+4 more");
    expect(lines.join("\n")).toContain("Step 7");
    for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(24);
  });

  it("caches by width and invalidates cleanly", () => {
    const widget = new PlanWidget(snapshot(), theme);
    const first = widget.render(30);
    expect(widget.render(30)).toBe(first);
    expect(widget.render(20)).not.toBe(first);
    widget.invalidate();
    expect(widget.render(20)).not.toBe(first);
    expect(widget.render(0)).toEqual([]);
  });
});
