import { describe, expect, it } from "vitest";
import { DEFAULT_OUTPUT_CAP_BYTES } from "yarp-cli/hooks/pi/output-cap.ts";
import yarpExtension, { commandBinding } from "yarp-cli/hooks/pi/yarp.ts";
import exportedExtension from "./index.js";

describe("YARP package", () => {
  it("exports the pinned upstream extension", () => {
    expect(exportedExtension).toBe(yarpExtension);
  });

  it("loads the reviewed global output cap", () => {
    expect(DEFAULT_OUTPUT_CAP_BYTES).toBe(5 * 1024);
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
