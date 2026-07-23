import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import {
  type EmojiSpinnerState,
  type EmojiSpinnerVariant,
  formatStyledEmojiSpinnerFrames,
  getEmojiSpinnerVariants,
} from "./live-stats.ts";

const RANDOM_SPINNER_OPTION = "🎲 Random";

function spinnerOptionLabel(spinner: EmojiSpinnerVariant): string {
  return `${spinner.pickerFrame ?? spinner.frames[0] ?? "?"} ${spinner.label}`;
}

export function spinnerArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const items: AutocompleteItem[] = [
    { value: "random", label: RANDOM_SPINNER_OPTION, description: "Choose a new random spinner" },
    { value: "current", label: "Current", description: "Show the selected spinner" },
    ...getEmojiSpinnerVariants().map((spinner) => ({
      value: spinner.name,
      label: spinnerOptionLabel(spinner),
      description: `${String(spinner.intervalMs)} ms per frame`,
    })),
  ];
  const matches = items.filter((item) => item.value.startsWith(normalizedPrefix));
  return matches.length > 0 ? matches : null;
}

export function applySpinner(ctx: ExtensionContext, state: EmojiSpinnerState): void {
  if (ctx.mode !== "tui") return;
  const spinner = state.current;
  ctx.ui.setWorkingIndicator({
    frames: formatStyledEmojiSpinnerFrames(spinner, {
      bold: (text) => ctx.ui.theme.bold(text),
      warning: (text) => ctx.ui.theme.fg("warning", text),
    }),
    intervalMs: spinner.intervalMs,
  });
}

async function chooseSpinner(
  ctx: ExtensionCommandContext,
  state: EmojiSpinnerState,
): Promise<string | undefined> {
  const variants = getEmojiSpinnerVariants();
  const optionToName = new Map(
    variants.map((spinner) => [spinnerOptionLabel(spinner), spinner.name]),
  );
  const option = await ctx.ui.select(`Spinner · ${state.current.label}`, [
    RANDOM_SPINNER_OPTION,
    ...optionToName.keys(),
  ]);
  if (option === undefined) return undefined;
  return option === RANDOM_SPINNER_OPTION ? "random" : optionToName.get(option);
}

async function requestedSpinner(
  args: string,
  ctx: ExtensionCommandContext,
  state: EmojiSpinnerState,
): Promise<string | undefined> {
  const requested = args.trim();
  if (requested.length > 0) return requested;
  if (ctx.mode === "tui") return chooseSpinner(ctx, state);
  ctx.ui.notify("Use /spinner <name> outside interactive mode.", "warning");
  return undefined;
}

function selectSpinner(requested: string, state: EmojiSpinnerState): boolean {
  if (requested.toLowerCase() === "random") {
    state.randomize();
    return true;
  }
  return state.select(requested);
}

function notifyUnknownSpinner(ctx: ExtensionCommandContext): void {
  const names = getEmojiSpinnerVariants()
    .map((spinner) => spinner.name)
    .join(", ");
  ctx.ui.notify(`Unknown spinner. Choose random or one of: ${names}`, "error");
}

export async function handleSpinnerCommand(
  args: string,
  ctx: ExtensionCommandContext,
  state: EmojiSpinnerState,
): Promise<void> {
  const requested = await requestedSpinner(args, ctx, state);
  if (requested === undefined) return;
  if (requested.toLowerCase() === "current") {
    ctx.ui.notify(`Spinner: ${state.current.label}`, "info");
    return;
  }
  if (!selectSpinner(requested, state)) {
    notifyUnknownSpinner(ctx);
    return;
  }
  applySpinner(ctx, state);
  ctx.ui.notify(`Spinner set to: ${state.current.label}`, "info");
}

export function registerSpinnerCommand(pi: ExtensionAPI, state: EmojiSpinnerState): void {
  pi.registerCommand("spinner", {
    description: "Choose the streaming emoji spinner",
    getArgumentCompletions: spinnerArgumentCompletions,
    handler: (args, ctx) => handleSpinnerCommand(args, ctx, state),
  });
}
