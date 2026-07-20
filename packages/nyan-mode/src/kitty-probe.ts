import { getCapabilities, setCapabilities } from "@earendil-works/pi-tui";

const PROBE_IMAGE_ID = 2_147_483_646;
const PROBE_TIMEOUT_MS = 500;

export const KITTY_GRAPHICS_QUERY = `\x1b_Gi=${String(PROBE_IMAGE_ID)},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\`;

type ProbeTerminal = {
  write(data: string): void;
};

type ProbeInput = {
  on(event: "data", listener: (data: unknown) => void): void;
  off(event: "data", listener: (data: unknown) => void): void;
};

export async function ensureKittyGraphics(
  terminal: unknown,
  input: ProbeInput = process.stdin,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<boolean> {
  if (getCapabilities().images === "kitty") return true;
  const writable = writableTerminal(terminalTarget(terminal));
  if (!writable || timeoutMs <= 0) return false;

  const supported = await queryKittyGraphics(writable, input, timeoutMs);
  if (supported) setCapabilities({ ...getCapabilities(), images: "kitty" });
  return supported;
}

function queryKittyGraphics(
  terminal: ProbeTerminal,
  input: ProbeInput,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    let response = "";
    let settled = false;
    const finish = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off("data", onData);
      resolve(supported);
    };
    const onData = (data: unknown): void => {
      response = (response + inputText(data)).slice(-4_096);
      if (response.includes(`i=${String(PROBE_IMAGE_ID)};OK`)) finish(true);
      if (response.includes(`i=${String(PROBE_IMAGE_ID)};`) && response.includes("ERROR")) {
        finish(false);
      }
    };
    const timer = setTimeout(() => {
      finish(false);
    }, timeoutMs);
    input.on("data", onData);
    try {
      terminal.write(KITTY_GRAPHICS_QUERY);
    } catch {
      finish(false);
    }
  });
}

function terminalTarget(value: unknown): unknown {
  return isRecord(value) && isRecord(value["terminal"]) ? value["terminal"] : value;
}

function writableTerminal(value: unknown): ProbeTerminal | undefined {
  if (!isRecord(value) || typeof value["write"] !== "function") return undefined;
  const write = value["write"];
  return {
    write(data: string): void {
      Reflect.apply(write, value, [data]);
    },
  };
}

function inputText(value: unknown): string {
  if (typeof value === "string") return value;
  return Buffer.isBuffer(value) ? value.toString("utf8") : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
