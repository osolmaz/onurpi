const SAFE_VALUE_FLAGS = new Set([
  "--provider",
  "--model",
  "--system-prompt",
  "--append-system-prompt",
  "--session-dir",
  "--models",
  "--tools",
  "-t",
  "--exclude-tools",
  "-xt",
  "--thinking",
  "--extension",
  "-e",
  "--skill",
]);

const SAFE_BOOLEAN_FLAGS = new Set([
  "--no-tools",
  "-nt",
  "--no-builtin-tools",
  "-nbt",
  "--no-extensions",
  "-ne",
  "--no-skills",
  "-ns",
  "--approve",
  "-a",
  "--no-approve",
  "-na",
  "--offline",
  "--keep-builtin-bash",
]);

const SESSION_FLAGS = new Set(["--session"]);
const REJECTED_FLAGS = new Set([
  "--print",
  "-p",
  "--continue",
  "-c",
  "--resume",
  "-r",
  "--no-session",
  "--help",
  "-h",
  "--version",
  "-v",
  "--api-key",
  "--session-id",
  "--fork",
  "--name",
  "-n",
  "--mode",
  "--export",
]);

type FlagKind = "safeValue" | "safeBoolean" | "session" | "rejected" | "unknown";

export type RestartArgumentPolicy =
  | { supported: true; replayArgs: string[] }
  | { supported: false; reason: string };

function flagKind(token: string): FlagKind {
  if (SAFE_VALUE_FLAGS.has(token)) return "safeValue";
  if (SAFE_BOOLEAN_FLAGS.has(token)) return "safeBoolean";
  if (SESSION_FLAGS.has(token)) return "session";
  if (REJECTED_FLAGS.has(token)) return "rejected";
  return "unknown";
}

class ArgumentParser {
  private readonly replayArgs: string[] = [];
  private readonly args: readonly string[];
  private index = 0;
  private sawSession = false;

  constructor(args: readonly string[]) {
    this.args = args;
  }

  parse(): RestartArgumentPolicy {
    while (this.index < this.args.length) {
      const failure = this.consume();
      if (failure) return { supported: false, reason: failure };
    }
    return { supported: true, replayArgs: this.replayArgs };
  }

  private consume(): string | undefined {
    const token = this.args[this.index];
    if (!token) return "Empty startup arguments are not supported.";
    if (token === "--" || !token.startsWith("-")) {
      return "Startup prompts and positional arguments are not supported.";
    }
    if (token.includes("=")) return `Combined flag syntax is not supported: ${token}`;
    return this.consumeFlag(token, flagKind(token));
  }

  private consumeFlag(token: string, kind: FlagKind): string | undefined {
    if (kind === "safeBoolean") {
      this.keepBoolean(token);
      return undefined;
    }
    if (kind === "safeValue") return this.keepValue(token);
    if (kind === "session") return this.consumeSession(token);
    if (kind === "rejected") return `${token} is not compatible with automatic restart.`;
    return `Unknown or unsupported startup flag: ${token}`;
  }

  private keepBoolean(token: string): void {
    this.replayArgs.push(token);
    this.index += 1;
  }

  private keepValue(token: string): string | undefined {
    const value = this.args[this.index + 1];
    if (value === undefined) return `${token} requires a value.`;
    this.replayArgs.push(token, value);
    this.index += 2;
    return undefined;
  }

  private consumeSession(token: string): string | undefined {
    const value = this.args[this.index + 1];
    if (value === undefined) return `${token} requires a value.`;
    if (this.sawSession) return "More than one startup session selector was provided.";
    this.sawSession = true;
    this.index += 2;
    return undefined;
  }
}

export function analyzeRestartArguments(args: readonly string[]): RestartArgumentPolicy {
  return new ArgumentParser(args).parse();
}

export function replacementArguments(policy: RestartArgumentPolicy, sessionFile: string): string[] {
  if (!policy.supported) throw new Error(policy.reason);
  return [...policy.replayArgs, "--session", sessionFile];
}
