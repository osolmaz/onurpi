import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_CAP_BYTES,
  DEFAULT_RECOVERY_CAP_BYTES,
  DEFAULT_RECOVERY_CAP_LINES,
} from "yarp-cli/hooks/pi/configuration.ts";
import yarpExtension, { commandBinding } from "yarp-cli/hooks/pi/yarp.ts";
import exportedExtension from "./index.js";

describe("YARP package", () => {
  it("exports the pinned upstream extension", () => {
    expect(exportedExtension).toBe(yarpExtension);
  });

  it("loads the reviewed output limits", () => {
    expect(DEFAULT_OUTPUT_CAP_BYTES).toBe(5 * 1024);
    expect(DEFAULT_RECOVERY_CAP_BYTES).toBe(32 * 1024);
    expect(DEFAULT_RECOVERY_CAP_LINES).toBe(1_900);
  });

  it("rewrites the command fields used by both shell tools", () => {
    const bash = { command: "git status" };
    commandBinding("bash", bash)?.replace("yarp run -- git status");
    expect(bash.command).toBe("yarp run -- git status");

    const exec = { cmd: "cargo test" };
    commandBinding("exec_command", exec)?.replace("yarp run -- cargo test");
    expect(exec.cmd).toBe("yarp run -- cargo test");
  });
});
