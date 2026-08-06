import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type BrowseScreen,
	defineMenu,
	type InputScreen,
	type MenuCloseReason,
	type ReviewScreen,
	type RunCustomInteractionResult,
	type RunMenuResult,
	type RunTaskResult,
	runCustomInteraction,
	runMenu,
	runTask,
} from "../src/index.js";

type Screen = "main";
type Action = "run";

const commandMenu = defineMenu<undefined, Screen, Action>({
	start: "main",
	screens: {
		main: () => ({
			kind: "actions",
			title: "Command menu",
			items: [{ id: "run", label: "Run", action: "run" }],
		}),
	},
	actions: {
		run: async ({ ctx }) => {
			await ctx.waitForIdle();
			return { kind: "close" };
		},
	},
});

const lifecycleMenu = defineMenu<undefined, Screen, Action, ExtensionContext>({
	start: "main",
	screens: {
		main: () => ({
			kind: "actions",
			title: "Lifecycle menu",
			items: [{ id: "run", label: "Run", action: "run" }],
		}),
	},
	actions: {
		run: async ({ ctx }) => {
			ctx.isIdle();
			// @ts-expect-error Lifecycle handlers must not gain command-only session methods.
			await ctx.waitForIdle();
			return { kind: "close" };
		},
	},
});

const browseScreen: BrowseScreen = {
	kind: "browse",
	title: "Catalog",
	items: [{ id: "one", label: "One", statusText: "Showing" }],
	viewportSize: "adaptive",
};
const inputScreen: InputScreen<Action> = {
	kind: "input",
	title: "Value",
	action: "run",
};
const reviewScreen: ReviewScreen<Action> = {
	kind: "review",
	title: "Review",
	content: "exact content",
	confirm: { id: "apply", label: "Apply", action: "run" },
};
const numericReviewScreen: ReviewScreen<Action> = {
	...reviewScreen,
	viewportSize: 14,
};
const adaptiveReviewScreen: ReviewScreen<Action> = {
	...reviewScreen,
	viewportSize: "adaptive",
};
void browseScreen;
void inputScreen;
void reviewScreen;
void numericReviewScreen;
void adaptiveReviewScreen;

const invalidInputScreen: InputScreen<Action> = {
	kind: "input",
	title: "Invalid",
	// @ts-expect-error Input actions stay within the menu action id union.
	action: "missing",
};
const invalidReviewScreen: ReviewScreen<Action> = {
	kind: "review",
	title: "Invalid",
	content: "content",
	// @ts-expect-error Review confirmation actions stay within the menu action id union.
	confirm: { id: "apply", label: "Apply", action: "missing" },
};
const invalidReviewViewport: ReviewScreen<Action> = {
	...reviewScreen,
	// @ts-expect-error Review viewports accept only a number or the adaptive policy.
	viewportSize: "fluid",
};
void invalidInputScreen;
void invalidReviewScreen;
void invalidReviewViewport;

declare const commandContext: ExtensionCommandContext;
declare const lifecycleContext: ExtensionContext;

void runMenu(commandContext, commandMenu, { getState: () => undefined });
void runMenu(lifecycleContext, lifecycleMenu, { getState: () => undefined });

function describeMenuResult(result: RunMenuResult): string {
	switch (result.kind) {
		case "closed": {
			const reason: MenuCloseReason = result.reason;
			return reason;
		}
		case "stale":
			return "stale";
		case "unsupported":
			return result.mode;
		case "error":
			return String(result.error);
		default: {
			const unreachable: never = result;
			return unreachable;
		}
	}
}
void describeMenuResult;

// @ts-expect-error Closed menu results require a termination reason.
const invalidClosedResult: RunMenuResult = { kind: "closed" };
// @ts-expect-error Menu close reasons are interaction-level Back or Close only.
const invalidCloseReason: MenuCloseReason = "cancelled";
void invalidClosedResult;
void invalidCloseReason;

const commandTask: Promise<RunTaskResult<number>> = runTask(commandContext, {
	label: "Command task",
	task: async ({ ctx, signal }) => {
		await ctx.waitForIdle();
		if (signal.aborted) return 0;
		return 1;
	},
});
void commandTask;

const commandInteraction: Promise<RunCustomInteractionResult<string>> = runCustomInteraction(
	commandContext,
	{
		create: ({ ctx, complete }) => ({
			render: () => [ctx.cwd],
			invalidate() {},
			handleInput: () => complete("done"),
		}),
	},
);
void commandInteraction;

void runCustomInteraction(lifecycleContext, {
	create: ({ ctx }) => ({
		render: () => [String(ctx.isIdle())],
		invalidate() {},
		// @ts-expect-error Lifecycle custom interactions must not gain command-only session methods.
		handleInput: () => void ctx.waitForIdle(),
	}),
});

void runTask(lifecycleContext, {
	label: "Lifecycle task",
	task: async ({ ctx }) => {
		ctx.isIdle();
		// @ts-expect-error Lifecycle tasks must not gain command-only session methods.
		await ctx.waitForIdle();
	},
});

// @ts-expect-error A command-only menu cannot run with a lifecycle context.
void runMenu(lifecycleContext, commandMenu, { getState: () => undefined });
