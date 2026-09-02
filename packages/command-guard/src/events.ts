export {
  COMMAND_ENVIRONMENT_EVENT,
  isCommandEnvironmentEvent,
  type CommandEnvironmentEvent,
} from "@onurpi/unified-exec/command-environment";
export {
  COMMAND_INPUT_EVENT,
  isCommandInputEvent,
  resolveCommandInput,
  type CommandInputArguments,
  type CommandInputEvent,
} from "@onurpi/unified-exec/command-input";

export function isControlOnlyInput(bytes: Uint8Array): boolean {
  return bytes.length > 0 && [...bytes].every((byte) => byte === 3 || byte === 4);
}
