import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const packageEntry = require.resolve("@osolmaz/regrafter");
const cli = join(dirname(packageEntry), "cli-main.js");
await import(pathToFileURL(cli).href);
