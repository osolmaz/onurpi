import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

import { BRAILLE_SPINNERS } from "../spinners.ts";
import { renderSpinnerViewerHtml } from "../viewer.ts";

const target = fileURLToPath(new URL("../viewer.html", import.meta.url));

writeFileSync(target, renderSpinnerViewerHtml(BRAILLE_SPINNERS));
console.log(
  `wrote ${relative(process.cwd(), target)} with ${String(BRAILLE_SPINNERS.length)} spinners`,
);
