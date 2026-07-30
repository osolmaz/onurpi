import process from "node:process";
import { runCli } from "pi-regraft/regrafter/cli";

process.exitCode = await runCli(process.argv.slice(2));
