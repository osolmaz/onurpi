import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, type Focusable, visibleWidth } from "@earendil-works/pi-tui";
import {
	createMenuScreenComponent,
	type MenuScreenComponent,
	type MenuScreenEvent,
} from "../src/components/index.js";
import type { MenuScreen } from "../src/types.js";

initTheme("dark", false);

type ScreenId = "browse";
type ActionId = "unused";

const keybindings = {
	matches(data: string, binding: string) {
		const inputs: Record<string, string> = {
			"tui.select.up": "k",
			"tui.select.down": "j",
			"tui.select.pageUp": "u",
			"tui.select.pageDown": "d",
			"tui.select.confirm": "y",
			"tui.select.cancel": "q",
		};
		return data === inputs[binding];
	},
	getKeys(binding: string) {
		const key = {
			"tui.select.up": "k",
			"tui.select.down": "j",
			"tui.select.pageUp": "u",
			"tui.select.pageDown": "d",
			"tui.select.confirm": "y",
			"tui.select.cancel": "q",
		}[binding];
		return key ? [key] : [];
	},
};

function browseScreen(): MenuScreen<ScreenId, ActionId> {
	return {
		kind: "browse",
		title: "Module browser",
		lines: ["Inspect supported modules without changing settings."],
		items: [
			{
				id: "model-raw",
				label: "Model",
				statusText: "Showing",
				description: "Current model",
				searchText: "provider llm",
				details: ["Preview: claude", "Variables: model"],
			},
			{
				id: "git-raw",
				label: "Git\u001b]8;;unsafe\u0007 branch",
				statusText: "Empty\u001b[31m",
				description: "Current Git branch",
				searchText: "repository vcs",
				details: [
					"Preview: none",
					"Reason: no repository",
					"Unsafe\u001b]8;;detail\u0007 text",
					"Style: cyan",
					"Root: referenced",
					"Reachable: yes",
				],
			},
			...Array.from({ length: 10 }, (_, index) => ({
				id: `module-${index}`,
				label: `Module ${index}`,
				statusText: index % 2 === 0 ? "Disabled" : "Not in format",
				description: `Description ${index}`,
				details: [`Detail ${index}`],
			})),
		],
		viewportSize: "adaptive",
		hint: "back",
	} as unknown as MenuScreen<ScreenId, ActionId>;
}

test("browse searches catalog metadata and preserves query and selection across detail", () => {
	const harness = componentHarness(browseScreen(), { rows: 14, selectedItemId: "model-raw" });
	const focusable = harness.component as MenuScreenComponent & Focusable;
	assert.equal("focused" in focusable, true);
	focusable.focused = true;
	assert.equal(harness.component.render(48).join("\n").includes(CURSOR_MARKER), true);

	harness.component.handleInput("\u001b[200~repository\u0007 vcs\u001b[201~");
	let rendered = plainRender(harness.component, 48).join("\n");
	assert.match(rendered, /Git branch.*\[Empty\]/u);
	assert.doesNotMatch(rendered, /Model|Module 0/u);
	assert.equal(harness.selectionChanges.at(-1), "git-raw");

	harness.component.handleInput("y");
	rendered = plainRender(harness.component, 48).join("\n");
	assert.match(rendered, /Status: Empty/u);
	assert.match(rendered, /Current Git branch/u);
	assert.match(rendered, /Preview: none/u);
	const rawDetail = harness.component.render(48).join("\n");
	assert.equal(rawDetail.includes(CURSOR_MARKER), false);
	assert.equal(rawDetail.includes("\u001b]8;;detail"), false);
	assert.equal(rawDetail.includes("\u001b[31m"), false);

	harness.component.handleInput("d");
	assert.match(plainRender(harness.component, 48).join("\n"), /Reachable: yes/u);
	harness.component.handleInput("q");
	rendered = plainRender(harness.component, 48).join("\n");
	assert.match(rendered, /repository.*vcs/u);
	assert.match(rendered, /Git branch/u);
	assert.equal(harness.component.render(48).join("\n").includes(CURSOR_MARKER), true);
});

test("browse is adaptively bounded, handles empty searches, and distinguishes Back from Close", () => {
	const harness = componentHarness(browseScreen(), { rows: 10 });
	for (const { width, rows } of [
		{ width: 60, rows: 16 },
		{ width: 24, rows: 8 },
		{ width: 8, rows: 4 },
		{ width: 1, rows: 1 },
	]) {
		harness.host.terminal.rows = rows;
		const lines = harness.component.render(width);
		assert.ok(lines.length <= Math.max(1, rows - 3), `${width}x${rows}`);
		assert.ok(
			lines.every((line) => visibleWidth(line) <= width),
			`${width}x${rows}`,
		);
	}

	const capped = componentHarness(
		{ ...browseScreen(), viewportSize: 2 } as MenuScreen<ScreenId, ActionId>,
		{ rows: 20 },
	);
	const cappedFrame = plainRender(capped.component, 60).join("\n");
	assert.match(cappedFrame, /Model[\s\S]*Git branch/u);
	assert.doesNotMatch(cappedFrame, /Module 0/u);
	assert.match(cappedFrame, /1-2\/12/u);

	harness.host.terminal.rows = 12;
	harness.component.render(40);
	for (const input of ["z", "z", "z"]) harness.component.handleInput(input);
	assert.match(plainRender(harness.component, 40).join("\n"), /No matching items/u);
	harness.component.handleInput("q");
	assert.deepEqual(harness.events, [{ kind: "back" }]);

	const close = componentHarness({ ...browseScreen(), hint: "close" } as MenuScreen<
		ScreenId,
		ActionId
	>);
	close.component.handleInput("\u0003");
	assert.deepEqual(close.events, [{ kind: "close" }]);
});

function plainRender(component: MenuScreenComponent, width: number) {
	return component.render(width).map((line) => stripVTControlCharacters(line));
}

function componentHarness(
	screen: MenuScreen<ScreenId, ActionId>,
	options: { rows?: number; selectedItemId?: string } = {},
) {
	const events: MenuScreenEvent[] = [];
	const selectionChanges: string[] = [];
	const host = { terminal: { rows: options.rows ?? 24 }, requestRender() {} };
	const component = createMenuScreenComponent({
		screen,
		selectedItemId: options.selectedItemId,
		tui: host,
		theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
		keybindings,
		onEvent: (event) => events.push(event),
		onSelectionChange: (itemId) => selectionChanges.push(itemId),
	});
	return { component, events, selectionChanges, host };
}
