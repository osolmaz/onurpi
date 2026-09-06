import { getBashParser } from "./bash-parser.ts";
import { installedPowerShellParser, type PowerShellParser } from "./powershell-parser.ts";
import { supportsPowerShellTool } from "./shell.ts";

async function parserStatus(name: string, probe: () => Promise<unknown>): Promise<string> {
  try {
    return `${name} parser: ${(await probe()) ? "available" : "unavailable (executable not found)"}.`;
  } catch {
    return `${name} parser: unavailable (parser check failed).`;
  }
}

export async function shellStatus(
  bashProbe: () => Promise<unknown> = getBashParser,
  powerShellParser: PowerShellParser = installedPowerShellParser,
): Promise<string[]> {
  const parsers = await Promise.all([
    parserStatus("Bash", bashProbe),
    parserStatus("PowerShell", () => powerShellParser.parse("")),
  ]);
  return [
    `PowerShell tool: ${supportsPowerShellTool() ? "supported on Windows" : "unavailable on this platform (the Pi backend requires Windows)"}.`,
    ...parsers,
    "Parser availability does not prove that a shell command will execute.",
  ];
}
