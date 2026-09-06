import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdapterCoverage } from "../src/adapters.ts";
import { registerShellGuards } from "../src/builtins.ts";
import { commandContext } from "../src/contexts.ts";
import { checkCommand } from "../src/decision.ts";
import { ExecutionCheckStore } from "../src/execution-check.ts";
import { withCommandGuardGuidance } from "../src/guidance.ts";
import { shellStatus } from "../src/status.ts";

afterEach(() => vi.restoreAllMocks());

describe("shell availability", () => {
  it.each(["linux", "darwin", "win32"] as const)("preserves Pi tool support on %s", (platform) => {
    vi.spyOn(process, "platform", "get").mockReturnValue(platform);
    const names: string[] = [];
    const events: string[] = [];
    const pi: Pick<ExtensionAPI, "registerTool" | "on"> = {
      registerTool: (tool) => {
        names.push(tool.name);
      },
      on: (event) => {
        events.push(event);
      },
    };
    registerShellGuards(pi, new ExecutionCheckStore());
    expect(names).toEqual(platform === "win32" ? ["bash", "powershell"] : ["bash"]);
    expect(events).toEqual(["user_bash"]);
  });

  it.each(["linux", "darwin", "win32"] as const)(
    "filters unavailable active tools on %s",
    (platform) => {
      vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      const active = ["read", "bash", "powershell", "exec_command"];
      const api = {
        getAllTools: () => active.map((name) => ({ name, parameters: {} })),
        getActiveTools: () => active,
        setActiveTools: vi.fn(),
      };
      new AdapterCoverage(api).enforce();
      if (platform === "win32") expect(api.setActiveTools).not.toHaveBeenCalled();
      else expect(api.setActiveTools).toHaveBeenCalledWith(["read", "bash", "exec_command"]);
    },
  );

  it("reports parser availability separately from tool support", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const lines = await shellStatus(() => Promise.resolve(true), {
      parse: () => Promise.resolve(undefined),
    });
    expect(lines).toContain("Bash parser: available.");
    expect(lines).toContain("PowerShell parser: unavailable (executable not found).");
    expect(lines[0]).toContain("unavailable on this platform");
    expect(lines.at(-1)).toContain("does not prove");
  });

  it("reports failed parser probes without leaking their output", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const lines = await shellStatus(() => Promise.reject(new Error("private output")), {
      parse: () => Promise.resolve({ commands: [], redirects: [], errors: [] }),
    });
    expect(lines).toContain("PowerShell tool: supported on Windows.");
    expect(lines).toContain("Bash parser: unavailable (parser check failed).");
    expect(lines).toContain("PowerShell parser: available.");
    expect(lines.join("\n")).not.toContain("private output");
  });
});

describe("recovery guidance", () => {
  it("keeps the existing prompt and adds the recovery boundary once", () => {
    const prompt = withCommandGuardGuidance("Existing instructions");
    expect(prompt).toMatch(/^Existing instructions\n\n/u);
    expect(prompt).toContain("one small, independent read-only command");
    expect(prompt).toContain("Keep the guard enabled");
    expect(prompt).toContain("Do not reroute a denied destructive action");
    expect(withCommandGuardGuidance(prompt)).toBe(prompt);
  });

  it("scopes a blocked result to the selected command", async () => {
    const result = await checkCommand(
      commandContext({ command: "echo safe", cwd: process.cwd(), shell: "fish" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("shell is not supported");
    expect(result.reason).toContain("This result applies to this command");
  });
});
