const MAX_REASON_LENGTH = 1000;

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function manualRestartCommand(sessionFile: string): string {
  return `pi --session ${shellQuote(sessionFile)}`;
}

export function recoveryMessage(sessionFile: string, reason: string): string {
  const boundedReason = reason.slice(0, MAX_REASON_LENGTH);
  const command = manualRestartCommand(sessionFile);
  return `Pi restart failed: ${boundedReason}\nSession: ${sessionFile}\nResume with: ${command}`;
}
