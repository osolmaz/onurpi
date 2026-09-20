import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BRAILLE_SPINNERS } from "./spinners.ts";
import { renderSpinnerViewerHtml } from "./viewer.ts";

const viewerPath = fileURLToPath(new URL("viewer.html", import.meta.url));

describe("renderSpinnerViewerHtml", () => {
  it("matches the committed viewer page", () => {
    expect(readFileSync(viewerPath, "utf8")).toBe(renderSpinnerViewerHtml(BRAILLE_SPINNERS));
  });

  it("carries every spinner, its description, and its first frame", () => {
    const page = renderSpinnerViewerHtml(BRAILLE_SPINNERS);

    for (const spinner of BRAILLE_SPINNERS) {
      expect(page).toContain(`"${spinner.id}"`);
      expect(page).toContain(spinner.description);
      expect(page).toContain(spinner.frames[0] ?? "");
    }
  });

  it("escapes a closing script tag inside the frame data", () => {
    const page = renderSpinnerViewerHtml([
      { id: "probe", name: "Probe", description: "</script>", intervalMs: 50, frames: ["⠁⠁"] },
    ]);

    expect(page.match(/<\/script>/gu)).toHaveLength(2);
    expect(page).toContain("<\\/script>");
  });
});
