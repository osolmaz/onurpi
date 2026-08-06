import { type Input, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { MenuBinding, MenuKeybindings, MenuScreenComponentOptions } from "./contracts.js";

export function renderFrame<ScreenId extends string, ActionId extends string>(
	title: string,
	lines: readonly string[],
	content: readonly string[],
	destination: "back" | "close",
	width: number,
	options: MenuScreenComponentOptions<ScreenId, ActionId>,
	confirmAction = "select",
): string[] {
	const safeWidth = Math.max(1, width);
	const result = [
		...wrapTextWithAnsi(
			options.theme.fg("accent", options.theme.bold(safeMenuText(title))),
			safeWidth,
		),
		...lines.flatMap((line) =>
			wrapTextWithAnsi(options.theme.fg("muted", safeMenuText(line)), safeWidth),
		),
		...(content.length > 0 ? ["", ...content] : []),
		...wrapTextWithAnsi(
			options.theme.fg("dim", menuHint(options.keybindings, destination, confirmAction)),
			safeWidth,
		),
	];
	return result.map((line) => truncateToWidth(line, safeWidth, ""));
}

export function menuHint(
	keybindings: MenuKeybindings,
	destination: "back" | "close",
	confirmAction: string,
) {
	const up = bindingText(keybindings, "tui.select.up");
	const down = bindingText(keybindings, "tui.select.down");
	const confirm = bindingText(keybindings, "tui.select.confirm");
	const cancel = bindingText(keybindings, "tui.select.cancel", "ctrl+c");
	return [
		...(up || down ? [`${[up, down].filter(Boolean).join("/")} navigate`] : []),
		...(confirm && confirmAction ? [`${confirm} ${confirmAction}`] : []),
		...(cancel ? [`${cancel} ${destination}`] : []),
		...(destination === "back" ? ["ctrl+c close"] : []),
	].join(" • ");
}

function bindingText(keybindings: MenuKeybindings, binding: MenuBinding, excluded?: string) {
	return keybindings
		.getKeys(binding)
		.filter((key) => key !== excluded)
		.map((key) => {
			if (key === "up") return "↑";
			if (key === "down") return "↓";
			if (key === "escape") return "esc";
			return safeMenuText(key);
		})
		.filter(Boolean)
		.join("/");
}

export function safeMenuText(value: unknown) {
	return replaceTerminalControls(value).replace(/\s+/gu, " ").trim();
}

export function handleSearchInput(input: Input, data: string) {
	input.handleInput(data);
	const value = replaceTerminalControls(input.getValue());
	if (value !== input.getValue()) input.setValue(value);
}

export function replaceTerminalControls(value: unknown) {
	return Array.from(String(value), (character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) ? " " : character;
	}).join("");
}
