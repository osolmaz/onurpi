import { createRequire } from "node:module";

import { Language, type Node, Parser } from "web-tree-sitter";

import { MAX_COMMAND_BYTES, MAX_PARSED_COMMANDS } from "./limits.ts";
import type { ParsedCommand, ParsedRedirect, ParsedScript, ResolvedWord } from "./types.ts";

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SIMPLE_BRACED_VARIABLE = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/u;
const POSSIBLE_GLOB = /[*?[\]{}]/u;

export type BashParser = Readonly<{
  parse(source: string, environment: NodeJS.ProcessEnv): ParsedScript;
}>;

const require = createRequire(import.meta.url);
let parserPromise: Promise<BashParser> | undefined;

function variableName(node: Node): string | undefined {
  const name = node.childForFieldName("name")?.text ?? node.namedChildren[0]?.text;
  return name && VARIABLE.test(name) ? name : undefined;
}

const VARIABLE_MUTATORS = new Set([
  "declare",
  "export",
  "local",
  "read",
  "readonly",
  "typeset",
  "unset",
]);

function collectCommandVariables(node: Node, assigned: Set<string>): void {
  const name = node.childForFieldName("name")?.text;
  if (!name || !VARIABLE_MUTATORS.has(name)) return;
  for (const argument of node.childrenForFieldName("argument")) {
    const candidate = argument.text.split("=", 1)[0];
    if (candidate && VARIABLE.test(candidate)) assigned.add(candidate);
  }
}

function collectAssignedVariables(root: Node): Set<string> {
  const assigned = new Set<string>();
  // eslint-disable-next-line complexity -- Variable mutation syntax is collected in one tree walk.
  const visit = (node: Node): void => {
    if (node.type === "variable_assignment") {
      const name = variableName(node);
      if (name) assigned.add(name);
    }
    if (node.type === "command") collectCommandVariables(node, assigned);
    if (node.type === "unset_command") {
      for (const child of node.namedChildren) {
        if (child.type === "variable_name" && VARIABLE.test(child.text)) assigned.add(child.text);
      }
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return assigned;
}

function uncertain(raw: string, variables: Set<string>, reason: string): ResolvedWord {
  return { raw, referencedVariables: [...variables].sort(), reason };
}

function appendVariable(
  raw: string,
  name: string,
  assigned: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
  variables: Set<string>,
): string | ResolvedWord {
  variables.add(name);
  if (assigned.has(name))
    return uncertain(raw, variables, `variable ${name} is assigned in the script`);
  const value = environment[name];
  return value ?? uncertain(raw, variables, `variable ${name} is not set`);
}

// eslint-disable-next-line complexity -- Shell word decoding must keep quote and expansion states together.
function decodeWord(
  raw: string,
  assigned: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
): ResolvedWord {
  const variables = new Set<string>();
  let result = "";
  let quote: "none" | "single" | "double" = "none";

  for (let index = 0; index < raw.length; index++) {
    const char = raw[index] ?? "";
    if (char === "'" && quote !== "double") {
      quote = quote === "single" ? "none" : "single";
      continue;
    }
    if (char === '"' && quote !== "single") {
      quote = quote === "double" ? "none" : "double";
      continue;
    }
    if (char === "\\" && quote !== "single") {
      const next = raw[index + 1];
      if (next === undefined) return uncertain(raw, variables, "trailing escape");
      if (next === "\n") {
        index++;
        continue;
      }
      if (quote === "double" && !["$", "`", '"', "\\"].includes(next)) result += "\\";
      result += next;
      index++;
      continue;
    }
    if (quote !== "single" && char === "`") {
      return uncertain(raw, variables, "command substitution");
    }
    if (quote !== "single" && char === "$" && raw[index + 1] === "(") {
      return uncertain(raw, variables, "command substitution");
    }
    if (quote !== "single" && char === "$" && raw[index + 1] === "{") {
      const end = raw.indexOf("}", index + 2);
      if (end < 0) return uncertain(raw, variables, "unterminated variable expansion");
      const expansion = raw.slice(index, end + 1);
      const match = SIMPLE_BRACED_VARIABLE.exec(expansion);
      if (!match?.[1]) return uncertain(raw, variables, "complex variable expansion");
      if (quote === "none") {
        variables.add(match[1]);
        return uncertain(raw, variables, "unquoted variable expansion");
      }
      const value = appendVariable(raw, match[1], assigned, environment, variables);
      if (typeof value !== "string") return value;
      result += value;
      index = end;
      continue;
    }
    if (quote !== "single" && char === "$") {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(raw.slice(index + 1));
      if (!match) return uncertain(raw, variables, "special or indirect variable expansion");
      if (quote === "none") {
        variables.add(match[0]);
        return uncertain(raw, variables, "unquoted variable expansion");
      }
      const value = appendVariable(raw, match[0], assigned, environment, variables);
      if (typeof value !== "string") return value;
      result += value;
      index += match[0].length;
      continue;
    }
    if (quote === "none" && char === "~" && result.length === 0) {
      return uncertain(raw, variables, "tilde expansion");
    }
    if (quote === "none" && POSSIBLE_GLOB.test(char)) {
      return uncertain(raw, variables, "glob or brace expansion");
    }
    result += char;
  }

  if (quote !== "none") return uncertain(raw, variables, "unterminated quote");
  return { raw, value: result, referencedVariables: [...variables].sort() };
}

function parseCommand(
  node: Node,
  assigned: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
): ParsedCommand | undefined {
  const nameNode = node.childForFieldName("name");
  if (!nameNode) return undefined;
  const decodedName = decodeWord(nameNode.text, assigned, environment);
  const name =
    decodedName.referencedVariables.length > 0
      ? uncertain(nameNode.text, new Set(decodedName.referencedVariables), "dynamic command name")
      : decodedName;
  return {
    name,
    args: node
      .childrenForFieldName("argument")
      .map((argument) => decodeWord(argument.text, assigned, environment)),
    source: node.text,
  };
}

function redirectOperator(node: Node, destination: Node): string {
  const prefix = node.text.slice(0, Math.max(0, node.text.lastIndexOf(destination.text)));
  const match = /(?:^|\d)(>>?|>\||<>|<&|>&)\s*$/u.exec(prefix);
  return match?.[1] ?? "unknown";
}

function parseRedirect(
  node: Node,
  assigned: ReadonlySet<string>,
  environment: NodeJS.ProcessEnv,
): ParsedRedirect | undefined {
  const destination = node.childForFieldName("destination");
  if (!destination) return undefined;
  return {
    destination: decodeWord(destination.text, assigned, environment),
    operator: redirectOperator(node, destination),
    source: node.text,
  };
}

function extractScript(root: Node, source: string, environment: NodeJS.ProcessEnv): ParsedScript {
  const assignedVariables = collectAssignedVariables(root);
  const commands: ParsedCommand[] = [];
  const redirects: ParsedRedirect[] = [];
  const visit = (node: Node): void => {
    if (node.type === "command") {
      if (commands.length >= MAX_PARSED_COMMANDS) {
        throw new Error("command count exceeds safety limit");
      }
      const command = parseCommand(node, assignedVariables, environment);
      if (command) commands.push(command);
    }
    if (node.type === "file_redirect") {
      const redirect = parseRedirect(node, assignedVariables, environment);
      if (redirect) redirects.push(redirect);
    }
    for (const child of node.namedChildren) visit(child);
  };
  visit(root);
  return { commands, redirects, assignedVariables, hasError: root.hasError, source };
}

async function initializeParser(): Promise<BashParser> {
  await Parser.init();
  const grammarPath = require.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const language = await Language.load(grammarPath);
  const parser = new Parser();
  parser.setLanguage(language);
  return {
    parse(source, environment) {
      if (Buffer.byteLength(source, "utf8") > MAX_COMMAND_BYTES) {
        throw new Error("command text exceeds safety limit");
      }
      const tree = parser.parse(source);
      if (!tree) throw new Error("Bash parser did not return a syntax tree");
      try {
        return extractScript(tree.rootNode, source, environment);
      } finally {
        tree.delete();
      }
    },
  };
}

export function getBashParser(): Promise<BashParser> {
  parserPromise ??= initializeParser();
  return parserPromise;
}

export function resetBashParserForTests(): void {
  parserPromise = undefined;
}
