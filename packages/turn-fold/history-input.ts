import { matchesKey } from "@earendil-works/pi-tui";

const DEFAULT_INPUT_LIMIT = 256;
const UNDO_LIMIT = 50;

export type HistoryInputAction = "cancel" | "changed" | "submit" | "unhandled";

type InputSnapshot = Readonly<{ cursor: number; text: string }>;

function previousCharacter(text: string, cursor: number): number {
  if (cursor <= 0) return 0;
  const previous = text.charCodeAt(cursor - 1);
  return previous >= 0xdc00 && previous <= 0xdfff ? Math.max(0, cursor - 2) : cursor - 1;
}

function nextCharacter(text: string, cursor: number): number {
  if (cursor >= text.length) return text.length;
  const current = text.charCodeAt(cursor);
  return current >= 0xd800 && current <= 0xdbff ? Math.min(text.length, cursor + 2) : cursor + 1;
}

function whitespaceWordStart(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && /\s/u.test(text[index - 1] ?? "")) index -= 1;
  while (index > 0 && !/\s/u.test(text[index - 1] ?? "")) index -= 1;
  return index;
}

function tokenCharacter(character: string): boolean {
  return /[\p{L}\p{N}_]/u.test(character);
}

function tokenWordStart(text: string, cursor: number): number {
  let index = cursor;
  while (index > 0 && !tokenCharacter(text[index - 1] ?? "")) index -= 1;
  while (index > 0 && tokenCharacter(text[index - 1] ?? "")) index -= 1;
  return index;
}

function tokenWordEnd(text: string, cursor: number): number {
  let index = cursor;
  while (index < text.length && !tokenCharacter(text[index] ?? "")) index += 1;
  while (index < text.length && tokenCharacter(text[index] ?? "")) index += 1;
  return index;
}

function matchesEither(
  data: string,
  first: Parameters<typeof matchesKey>[1],
  second: Parameters<typeof matchesKey>[1],
): boolean {
  return matchesKey(data, first) || matchesKey(data, second);
}

function isPrintableInput(data: string): boolean {
  if (!data || data.startsWith("\u001b")) return false;
  return Array.from(data).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0x20 && codePoint !== 0x7f;
  });
}

export class HistoryInput {
  private cursorIndex = 0;
  private killBuffer = "";
  private readonly limit: number;
  private textValue = "";
  private readonly undo: InputSnapshot[] = [];

  constructor(initial = "", limit = DEFAULT_INPUT_LIMIT) {
    this.limit = Math.max(1, Math.floor(limit));
    this.textValue = initial.slice(0, this.limit);
    this.cursorIndex = this.textValue.length;
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  get text(): string {
    return this.textValue;
  }

  handle(data: string): HistoryInputAction {
    if (matchesKey(data, "enter")) return "submit";
    if (matchesKey(data, "escape")) return "cancel";
    if (this.handleMovement(data)) return "changed";
    if (this.handleKill(data)) return "changed";
    if (this.handleDeletion(data)) return "changed";
    if (this.handleEditing(data)) return "changed";
    if (!isPrintableInput(data)) return "unhandled";
    this.replace(this.cursorIndex, this.cursorIndex, data);
    return "changed";
  }

  cursorText(marker = "▏"): string {
    return `${this.textValue.slice(0, this.cursorIndex)}${marker}${this.textValue.slice(this.cursorIndex)}`;
  }

  private handleMovement(data: string): boolean {
    return this.handleCharacterMovement(data) || this.handleWordMovement(data);
  }

  private handleCharacterMovement(data: string): boolean {
    if (matchesEither(data, "ctrl+a", "home")) {
      this.cursorIndex = 0;
      return true;
    }
    if (matchesEither(data, "ctrl+e", "end")) {
      this.cursorIndex = this.textValue.length;
      return true;
    }
    if (matchesEither(data, "ctrl+b", "left")) {
      this.cursorIndex = previousCharacter(this.textValue, this.cursorIndex);
      return true;
    }
    if (matchesEither(data, "ctrl+f", "right")) {
      this.cursorIndex = nextCharacter(this.textValue, this.cursorIndex);
      return true;
    }
    return false;
  }

  private handleWordMovement(data: string): boolean {
    if (matchesKey(data, "alt+b")) {
      this.cursorIndex = tokenWordStart(this.textValue, this.cursorIndex);
      return true;
    }
    if (matchesKey(data, "alt+f")) {
      this.cursorIndex = tokenWordEnd(this.textValue, this.cursorIndex);
      return true;
    }
    return false;
  }

  private handleKill(data: string): boolean {
    if (matchesKey(data, "ctrl+w")) {
      const start = whitespaceWordStart(this.textValue, this.cursorIndex);
      this.kill(start, this.cursorIndex);
      return true;
    }
    if (matchesKey(data, "ctrl+k")) {
      this.kill(this.cursorIndex, this.textValue.length);
      return true;
    }
    if (matchesKey(data, "ctrl+u")) {
      this.kill(0, this.cursorIndex);
      return true;
    }
    if (matchesKey(data, "alt+backspace")) {
      this.kill(tokenWordStart(this.textValue, this.cursorIndex), this.cursorIndex);
      return true;
    }
    if (matchesKey(data, "alt+d")) {
      this.kill(this.cursorIndex, tokenWordEnd(this.textValue, this.cursorIndex));
      return true;
    }
    if (matchesKey(data, "ctrl+y")) {
      this.replace(this.cursorIndex, this.cursorIndex, this.killBuffer);
      return true;
    }
    return false;
  }

  private handleDeletion(data: string): boolean {
    if (matchesKey(data, "backspace")) {
      this.replace(previousCharacter(this.textValue, this.cursorIndex), this.cursorIndex, "");
      return true;
    }
    if (matchesKey(data, "delete") || matchesKey(data, "ctrl+d")) {
      this.replace(this.cursorIndex, nextCharacter(this.textValue, this.cursorIndex), "");
      return true;
    }
    return false;
  }

  private handleEditing(data: string): boolean {
    if (matchesKey(data, "ctrl+t")) {
      const rightStart =
        this.cursorIndex >= this.textValue.length
          ? previousCharacter(this.textValue, this.cursorIndex)
          : this.cursorIndex;
      const leftStart = previousCharacter(this.textValue, rightStart);
      const rightEnd = nextCharacter(this.textValue, rightStart);
      if (leftStart === rightStart || rightStart === rightEnd) return true;
      const left = this.textValue.slice(leftStart, rightStart);
      const right = this.textValue.slice(rightStart, rightEnd);
      this.replace(leftStart, rightEnd, `${right}${left}`);
      return true;
    }
    if (matchesKey(data, "ctrl+_")) {
      const previous = this.undo.pop();
      if (previous) {
        this.textValue = previous.text;
        this.cursorIndex = previous.cursor;
      }
      return true;
    }
    return false;
  }

  private kill(start: number, end: number): void {
    this.killBuffer = this.textValue.slice(start, end);
    this.replace(start, end, "");
  }

  private replace(start: number, end: number, value: string): void {
    const available = this.limit - (this.textValue.length - (end - start));
    const inserted = value.slice(0, Math.max(0, available));
    const next = `${this.textValue.slice(0, start)}${inserted}${this.textValue.slice(end)}`;
    if (next === this.textValue && start === end) return;
    this.undo.push({ cursor: this.cursorIndex, text: this.textValue });
    while (this.undo.length > UNDO_LIMIT) this.undo.shift();
    this.textValue = next;
    this.cursorIndex = start + inserted.length;
  }
}
