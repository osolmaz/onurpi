import assert from "node:assert/strict";
import test from "node:test";
import { stripVTControlCharacters } from "node:util";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createCustomSelectorHarness, createMockContext } from "../../../test/support.js";
import { createMenuScreenComponent } from "../src/components/index.js";
import { defineMenu, type ReviewScreen, runMenu } from "../src/index.js";

initTheme("dark", false);

type ScreenId = "review";
type ActionId = "apply";

const reviewScreen: ReviewScreen<ActionId> = {
	kind: "review",
	title: "Review changes",
	content: "line 1\nline 2\nline 3\nline 4\nline 5",
	format: { kind: "text" },
	viewportSize: 3,
	confirm: { id: "raw-apply", label: "Apply", action: "apply" },
	hint: "back",
};

test("review preserves whitespace, sanitizes controls, and bounds exact text at every width", () => {
	const harness = reviewComponentHarness({
		...reviewScreen,
		content:
			"  indented\tvalue\n你🙂very-long-token\nunsafe\u001b]8;;https://unsafe.example\u0007text",
		viewportSize: 20,
	});
	for (const width of [1, 2, 8, 20, 40, 80, 120]) {
		const lines = harness.component.render(width);
		assert.ok(
			lines.every((line) => visibleWidth(line) <= width),
			`width ${width}`,
		);
		assert.equal(lines.join("\n").includes("\u001b]8;;https://unsafe.example"), false);
	}
	const rendered = stripVTControlCharacters(harness.component.render(80).join("\n"));
	assert.match(rendered, / {2}indented {2,}value/);
	assert.match(rendered, /你🙂very-long-token/);
});

test("fixed and default review frames remain byte-for-byte compatible", () => {
	const content = Array.from({ length: 20 }, (_, index) => `row ${index + 1}`).join("\n");
	const fixed = reviewComponentHarness({ ...reviewScreen, content });
	assert.deepEqual(plainLines(fixed.component, 80), [
		"Review changes",
		"",
		"row 1",
		"row 2",
		"row 3",
		"1-3/20",
		"k/j navigate • l Apply • q back • ctrl+c close",
	]);

	const defaultViewport = reviewComponentHarness({
		...reviewScreen,
		content,
		viewportSize: undefined,
	});
	assert.deepEqual(plainLines(defaultViewport.component, 80), [
		"Review changes",
		"",
		...Array.from({ length: 14 }, (_, index) => `row ${index + 1}`),
		"1-14/20",
		"k/j navigate • l Apply • q back • ctrl+c close",
	]);
});

test("adaptive review degrades explicitly at constrained terminal heights", () => {
	const content = Array.from({ length: 10 }, (_, index) => `row ${index + 1}`).join("\n");
	const harness = reviewComponentHarness(
		{ ...reviewScreen, content, viewportSize: "adaptive" },
		false,
		4,
	);
	assert.deepEqual(plainLines(harness.component, 80), ["row 1"]);

	harness.setTerminalRows(5);
	assert.deepEqual(plainLines(harness.component, 80), ["Review changes", "row 1"]);

	harness.setTerminalRows(6);
	assert.deepEqual(plainLines(harness.component, 80), [
		"Review changes",
		"row 1",
		"l Apply • q back • ctrl+c close • k/j navigate",
	]);

	harness.setTerminalRows(7);
	assert.deepEqual(plainLines(harness.component, 80), [
		"Review changes",
		"row 1",
		"1-1/10",
		"l Apply • q back • ctrl+c close • k/j navigate",
	]);

	harness.setTerminalRows(8);
	assert.deepEqual(plainLines(harness.component, 80), [
		"Review changes",
		"",
		"row 1",
		"1-1/10",
		"k/j navigate • l Apply • q back • ctrl+c close",
	]);
});

test("adaptive review restores wrapped context and exceeds the numeric viewport ceiling safely", () => {
	const content = Array.from({ length: 100 }, (_, index) => `row ${index + 1}`).join("\n");
	const typical = reviewComponentHarness(
		{
			...reviewScreen,
			title: "Review configuration changes",
			lines: ["Supporting context that wraps at narrow widths"],
			content,
			viewportSize: "adaptive",
		},
		false,
		30,
	);
	const typicalLines = plainLines(typical.component, 18);
	assert.equal(typicalLines.length, 27);
	assert.ok(typicalLines.some((line) => line.includes("Supporting")));
	assert.ok(typicalLines.some((line) => /\d+-\d+\/100/u.test(line)));
	assert.ok(typicalLines.every((line) => visibleWidth(line) <= 18));

	const large = reviewComponentHarness(
		{ ...reviewScreen, content, viewportSize: "adaptive" },
		false,
		80,
	);
	const largeLines = plainLines(large.component, 80);
	assert.equal(largeLines.length, 77);
	assert.ok(largeLines.includes("row 73"));
	assert.ok(largeLines.every((line) => visibleWidth(line) <= 80));
});

test("adaptive review resizes, reflows, clamps, and pages by the latest rendered viewport", () => {
	const content = Array.from({ length: 20 }, (_, index) => `row ${index + 1}`).join("\n");
	const harness = reviewComponentHarness(
		{ ...reviewScreen, content, viewportSize: "adaptive" },
		false,
		12,
	);
	let rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 1[\s\S]*row 5/);
	assert.match(rendered, /1-5\/20/);

	harness.component.handleInput("\u001b[F");
	rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 16[\s\S]*row 20/);
	assert.match(rendered, /16-20\/20/);

	harness.setTerminalRows(7);
	rendered = plainRender(harness.component, 30);
	assert.match(rendered, /row 16/);
	assert.match(rendered, /16-16\/20/);

	harness.setTerminalRows(14);
	rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 14[\s\S]*row 20/);
	assert.match(rendered, /14-20\/20/);
	harness.component.handleInput("u");
	rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 7[\s\S]*row 13/);

	harness.setTerminalRows(9);
	rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 7[\s\S]*row 8/);
	harness.component.handleInput("d");
	rendered = plainRender(harness.component, 80);
	assert.match(rendered, /row 9[\s\S]*row 10/);
	assert.ok(harness.component.render(20).every((line) => visibleWidth(line) <= 20));
});

test("review scrolls by injected keys, pages, and clamps after resize", () => {
	const harness = reviewComponentHarness({
		...reviewScreen,
		content: Array.from({ length: 10 }, (_, index) => `row ${index + 1}`).join("\n"),
	});
	let rendered = plainRender(harness.component, 40);
	assert.match(rendered, /row 1[\s\S]*row 3/);
	assert.doesNotMatch(rendered, /row 4/);

	harness.component.handleInput("j");
	rendered = plainRender(harness.component, 40);
	assert.match(rendered, /row 2[\s\S]*row 4/);
	harness.component.handleInput("d");
	rendered = plainRender(harness.component, 40);
	assert.match(rendered, /row 5[\s\S]*row 7/);
	harness.component.handleInput("\u001b[F");
	rendered = plainRender(harness.component, 40);
	assert.match(rendered, /row 8[\s\S]*row 10/);
	assert.match(rendered, /8-10\/10/);
	assert.ok(harness.component.render(8).every((line) => visibleWidth(line) <= 8));
});

test("review confirmation dispatches raw identity and exits remain Back versus Close", () => {
	const confirm = reviewComponentHarness(reviewScreen);
	confirm.component.handleInput("l");
	assert.deepEqual(confirm.events, [{ kind: "activate", itemId: "raw-apply" }]);

	const readOnly = reviewComponentHarness({ ...reviewScreen, confirm: undefined });
	readOnly.component.handleInput("l");
	assert.deepEqual(readOnly.events, []);
	readOnly.component.handleInput("q");
	assert.deepEqual(readOnly.events, [{ kind: "back" }]);

	const close = reviewComponentHarness(reviewScreen);
	close.component.handleInput("\u0003");
	assert.deepEqual(close.events, [{ kind: "close" }]);
});

test("review formats code and diffs through theme-aware display paths", () => {
	const code = reviewComponentHarness({
		...reviewScreen,
		content: "const answer = 42;",
		format: { kind: "code", language: "typescript" },
		confirm: undefined,
	});
	assert.match(stripVTControlCharacters(code.component.render(80).join("\n")), /const answer = 42/);

	const diff = reviewComponentHarness(
		{
			...reviewScreen,
			content: "@@ header\n-old\n+new\n same",
			format: { kind: "diff", filePath: "settings.json" },
			confirm: undefined,
		},
		true,
	);
	const rendered = diff.component.render(80).join("\n");
	assert.match(rendered, /toolDiffRemoved:-old/);
	assert.match(rendered, /toolDiffAdded:\+new/);
	assert.match(rendered, /accent:@@ header/);
});

test("code review uses the injected theme for inferred syntax tokens and safe fallback", () => {
	const inferred = reviewComponentHarness(
		{
			...reviewScreen,
			content: "const answer: number = 42;",
			format: { kind: "code", filePath: "answer.ts" },
			confirm: undefined,
		},
		true,
	);
	const highlighted = inferred.component.render(200).join("\n");
	assert.match(highlighted, /syntaxKeyword:const/u);
	assert.match(highlighted, /syntaxType:number/u);
	assert.match(highlighted, /syntaxNumber:42/u);

	const explicit = reviewComponentHarness(
		{
			...reviewScreen,
			content: "++>---",
			format: { kind: "code", language: "brainfuck" },
			confirm: undefined,
		},
		true,
	);
	const explicitlyHighlighted = explicit.component.render(80).join("\n");
	assert.match(explicitlyHighlighted, /\+\+>/u);
	assert.match(explicitlyHighlighted, /syntaxNumber:-/u);

	const unknown = reviewComponentHarness(
		{
			...reviewScreen,
			content: "plain value",
			format: { kind: "code", language: "not-a-language" },
			confirm: undefined,
		},
		true,
	);
	const fallback = unknown.component.render(80).join("\n");
	assert.match(fallback, /mdCodeBlock:mdCodeBlock:plain value/u);
	assert.doesNotMatch(fallback, /syntax(?:Keyword|Type|Number):/u);
});

test("TUI adaptive review reads live host rows and invokes its raw confirmation action", async () => {
	const invoked: string[] = [];
	const frameHeights: number[] = [];
	const context = createMockContext({
		mode: "tui",
		hasUI: true,
		custom: async (factory: unknown) => {
			const harness = createCustomSelectorHarness(factory, 80, undefined, 7);
			frameHeights.push(harness.render().length);
			harness.setTerminalRows(12);
			frameHeights.push(harness.render().length);
			harness.handleInput("tui.select.confirm");
			return harness.result;
		},
	});
	const menu = defineMenu<undefined, ScreenId, ActionId>({
		start: "review",
		screens: {
			review: () => ({
				...reviewScreen,
				content: Array.from({ length: 20 }, (_, index) => `row ${index + 1}`).join("\n"),
				viewportSize: "adaptive",
			}),
		},
		actions: {
			apply: async ({ itemId }) => {
				invoked.push(itemId);
				return { kind: "close" };
			},
		},
	});
	assert.deepEqual(await runMenu(context.ctx, menu, { getState: () => undefined }), {
		kind: "closed",
		reason: "close",
	});
	assert.deepEqual(invoked, ["raw-apply"]);
	assert.deepEqual(frameHeights, [4, 9]);
});

test("RPC adaptive review matches default bounded pagination without custom TUI", async () => {
	async function collect(viewportSize: ReviewScreen<ActionId>["viewportSize"]) {
		const titles: string[] = [];
		const context = createMockContext({
			mode: "rpc",
			hasUI: true,
			select: async (title: string, choices: string[]) => {
				titles.push(title);
				return choices.find((choice) => choice.startsWith("Next")) ?? "Back";
			},
			custom: async () => {
				throw new Error("RPC review must not open custom TUI");
			},
		});
		const menu = defineMenu<undefined, ScreenId, ActionId>({
			start: "review",
			screens: {
				review: () => ({
					...reviewScreen,
					content: Array.from({ length: 20 }, (_, index) => `row ${index + 1}`).join("\n"),
					viewportSize,
					confirm: undefined,
				}),
			},
			actions: { apply: async () => ({ kind: "close" }) },
		});
		assert.deepEqual(await runMenu(context.ctx, menu, { getState: () => undefined }), {
			kind: "closed",
			reason: "back",
		});
		return titles;
	}

	const omitted = await collect(undefined);
	const adaptive = await collect("adaptive");
	assert.deepEqual(adaptive, omitted);
	assert.equal(adaptive.length, 3);
	assert.match(adaptive[0] ?? "", /row 1[\s\S]*row 8/);
	assert.match(adaptive[2] ?? "", /row 17[\s\S]*row 20/);
});

test("RPC review paginates bounded content and preserves colliding confirmation identity", async () => {
	const titles: string[] = [];
	const choicesSeen: string[][] = [];
	let call = 0;
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (title: string, choices: string[], options?: { signal?: AbortSignal }) => {
			call += 1;
			titles.push(title);
			choicesSeen.push(choices);
			assert.equal(options?.signal?.aborted, false);
			assert.ok(title.length < 2000);
			if (call === 1) return choices.find((choice) => choice.startsWith("Next"));
			return choices.find((choice) => choice.startsWith("Next") && choice !== "Next");
		},
		custom: async () => {
			throw new Error("RPC review must not open custom TUI");
		},
	});
	const content = Array.from({ length: 30 }, (_, index) => `row ${index + 1}`).join("\n");
	const menu = defineMenu<undefined, ScreenId, ActionId>({
		start: "review",
		screens: {
			review: () => ({
				...reviewScreen,
				content,
				confirm: { id: "confirm-next", label: "Next", action: "apply" },
			}),
		},
		actions: {
			apply: async ({ itemId }) => {
				assert.equal(itemId, "confirm-next");
				return { kind: "close" };
			},
		},
	});

	assert.deepEqual(await runMenu(context.ctx, menu, { getState: () => undefined }), {
		kind: "closed",
		reason: "close",
	});
	assert.equal(call, 2);
	assert.match(titles[0] ?? "", /row 1/);
	assert.doesNotMatch(titles[0] ?? "", /row 30/);
	assert.match(titles[1] ?? "", /row 4/);
	assert.equal(new Set(choicesSeen[1]).size, choicesSeen[1]?.length);
});

test("owner abort dismisses an unanswered adaptive RPC review without invoking confirmation", async () => {
	const owner = new AbortController();
	let reportOpened: (() => void) | undefined;
	const opened = new Promise<void>((resolve) => {
		reportOpened = resolve;
	});
	let invoked = false;
	const context = createMockContext({
		mode: "rpc",
		hasUI: true,
		select: async (_title: string, _choices: string[], options?: { signal?: AbortSignal }) => {
			reportOpened?.();
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return undefined;
		},
	});
	const menu = defineMenu<undefined, ScreenId, ActionId>({
		start: "review",
		screens: {
			review: () => ({ ...reviewScreen, viewportSize: "adaptive" }),
		},
		actions: {
			apply: async () => {
				invoked = true;
				return { kind: "close" };
			},
		},
	});
	const running = runMenu(context.ctx, menu, {
		getState: () => undefined,
		signal: owner.signal,
	});
	await opened;
	owner.abort(new DOMException("Session replaced", "AbortError"));
	assert.deepEqual(await running, { kind: "stale" });
	assert.equal(invoked, false);
});

function reviewComponentHarness(screen: ReviewScreen<ActionId>, themed = false, terminalRows = 24) {
	const events: Array<{ kind: "back" | "close" } | { kind: "activate"; itemId: string }> = [];
	const terminal = { rows: terminalRows };
	const component = createMenuScreenComponent<ScreenId, ActionId>({
		screen,
		tui: { terminal, requestRender() {} },
		theme: {
			fg: (color: string, text: string) => (themed ? `${color}:${text}` : text),
			bold: (text: string) => text,
		},
		keybindings: {
			matches(data: string, binding: string) {
				const values: Record<string, string> = {
					"tui.select.up": "k",
					"tui.select.down": "j",
					"tui.select.pageUp": "u",
					"tui.select.pageDown": "d",
					"tui.select.confirm": "l",
					"tui.select.cancel": "q",
				};
				return data === values[binding];
			},
			getKeys(binding: string) {
				const values: Record<string, readonly string[]> = {
					"tui.select.up": ["k"],
					"tui.select.down": ["j"],
					"tui.select.pageUp": ["u"],
					"tui.select.pageDown": ["d"],
					"tui.select.confirm": ["l"],
					"tui.select.cancel": ["q", "ctrl+c"],
				};
				return values[binding] ?? [];
			},
		},
		onEvent: (event) => events.push(event),
	});
	return {
		component,
		events,
		setTerminalRows(rows: number) {
			terminal.rows = rows;
		},
	};
}

function plainLines(component: { render(width: number): string[] }, width: number) {
	return component.render(width).map((line) => stripVTControlCharacters(line));
}

function plainRender(component: { render(width: number): string[] }, width: number) {
	return plainLines(component, width).join("\n");
}
