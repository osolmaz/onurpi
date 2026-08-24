const MAX_DIAGNOSTIC_LENGTH = 1000;

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function manualRestartCommand(sessionFile: string): string {
  return `pi --session ${shellQuote(sessionFile)}`;
}

export function recoveryMessage(sessionFile: string, reason: string): string {
  const command = manualRestartCommand(sessionFile);
  const prefix = `Pi restart failed: ${reason}\nSession: ${sessionFile}\nResume with: ${command}`;
  return prefix.slice(0, MAX_DIAGNOSTIC_LENGTH);
}
