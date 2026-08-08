import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { loadConfig } from "./config.ts";
import {
	buildCodexHeaders,
	buildCompactionRequestBody,
	buildReplacementHistory,
	buildToolPayload,
	callRemoteCompaction,
	effectiveInputForBranch,
	findNativeCheckpoint,
	isJsonObject,
	isOpenAICodexModel,
	mergeFeatureHeader,
	modelKey,
	NATIVE_COMPACTION_KIND,
	NATIVE_COMPACTION_VERSION,
	resolveCodexResponsesUrl,
	stripInputFromPayload,
	type JsonObject,
	type NativeCompactionDetails,
	type ResponseItem,
} from "./native-compaction.ts";

type CachedPayloadShape = {
	modelKey: string;
	payload: JsonObject;
};

type CompactionStatus = {
	state: "running" | "complete" | "failed";
	error?: string;
};

type ForcedCompactionState = {
	sessionId: string;
	phase: "waitingForSettle" | "compacting" | "compacted";
};

const COMPACTION_STATUS_KIND = "openai-codex-compaction-status";
const CONTINUATION_PROMPT = "Compaction completed. Continue.";

function localMarker(): string {
	return `OpenAI Codex native compaction checkpoint (${randomUUID()}).`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function effectiveBaseUrl(model: Model<any>): string | undefined {
	return model.baseUrl;
}

function setFeatureHeader(headers: Record<string, string | null>): void {
	const existing = Object.entries(headers).find(([name]) => name.toLowerCase() === "x-codex-beta-features");
	if (existing) {
		headers[existing[0]] = mergeFeatureHeader(existing[1]);
	} else {
		headers["x-codex-beta-features"] = mergeFeatureHeader(undefined);
	}
}

export default function codexCompactionExtension(pi: ExtensionAPI): void {
	const payloadShapeBySession = new Map<string, CachedPayloadShape>();
	let forcedCompaction: ForcedCompactionState | undefined;

	pi.registerEntryRenderer<CompactionStatus>(COMPACTION_STATUS_KIND, (entry, _options, theme) => {
		const data = entry.data;
		if (data?.state === "running") {
			return new Text(theme.fg("accent", "◐ OpenAI compaction running…"), 0, 0);
		}
		if (data?.state === "complete") {
			return new Text(theme.fg("success", "✓ OpenAI compaction complete"), 0, 0);
		}
		const suffix = data?.error ? `: ${data.error}` : "";
		return new Text(theme.fg("error", `✗ OpenAI compaction failed${suffix}`), 0, 0);
	});

	const appendCompactionStatus = (ctx: ExtensionContext, status: CompactionStatus): void => {
		if (ctx.mode === "tui") pi.appendEntry(COMPACTION_STATUS_KIND, status);
	};

	const withCompactionStatus = async <T>(
		ctx: ExtensionContext,
		operation: () => Promise<T>,
	): Promise<T> => {
		appendCompactionStatus(ctx, { state: "running" });
		try {
			const result = await operation();
			appendCompactionStatus(ctx, { state: "complete" });
			return result;
		} catch (error) {
			appendCompactionStatus(ctx, { state: "failed", error: errorMessage(error) });
			throw error;
		}
	};

	const createNativeCheckpoint = async (params: {
		ctx: ExtensionContext;
		model: Model<any>;
		input: ResponseItem[];
		basePayload?: JsonObject;
		signal?: AbortSignal;
	}): Promise<{ details: NativeCompactionDetails; usage?: Awaited<ReturnType<typeof callRemoteCompaction>>["usage"] }> => {
		const auth = await params.ctx.modelRegistry.getApiKeyAndHeaders(params.model);
		if (!auth.ok || !auth.apiKey) {
			throw new Error(auth.ok ? "OpenAI Codex authentication is unavailable." : auth.error);
		}
		const sessionId = params.ctx.sessionManager.getSessionId();
		const allTools = pi.getAllTools();
		const body = buildCompactionRequestBody({
			basePayload: params.basePayload,
			model: params.model,
			input: params.input,
			instructions: params.ctx.getSystemPrompt(),
			tools: buildToolPayload(allTools, pi.getActiveTools()),
			sessionId,
		});
		const remote = await callRemoteCompaction({
			url: resolveCodexResponsesUrl(effectiveBaseUrl(params.model)),
			headers: buildCodexHeaders({ apiKey: auth.apiKey, headers: auth.headers, sessionId }),
			body,
			model: params.model,
			signal: params.signal,
		});
		return {
			details: {
				kind: NATIVE_COMPACTION_KIND,
				version: NATIVE_COMPACTION_VERSION,
				modelKey: modelKey(params.model),
				replacementHistory: buildReplacementHistory(params.input, remote.compactionItem),
			},
			usage: remote.usage,
		};
	};

	pi.on("session_start", () => {
		payloadShapeBySession.clear();
		forcedCompaction = undefined;
	});
	pi.on("session_shutdown", () => {
		payloadShapeBySession.clear();
		forcedCompaction = undefined;
	});
	pi.on("model_select", (_event, ctx) => {
		payloadShapeBySession.delete(ctx.sessionManager.getSessionId());
		forcedCompaction = undefined;
	});

	pi.on("context", (event, ctx) => {
		const checkpoint = findNativeCheckpoint(ctx.sessionManager.getBranch() as SessionEntry[]);
		if (checkpoint.status === "none") return undefined;
		return {
			messages: event.messages.filter((message) => message.role !== "compactionSummary"),
		};
	});

	pi.on("before_provider_headers", (event, ctx) => {
		if (!isOpenAICodexModel(ctx.model)) return;
		setFeatureHeader(event.headers);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model) || !isJsonObject(event.payload)) return undefined;

		const sessionId = ctx.sessionManager.getSessionId();
		const basePayload = stripInputFromPayload(event.payload);
		payloadShapeBySession.set(sessionId, { modelKey: modelKey(model), payload: basePayload });

		const branch = ctx.sessionManager.getBranch() as SessionEntry[];
		const checkpoint = findNativeCheckpoint(branch);

		try {
			if (checkpoint.status === "none") return undefined;
			const input = effectiveInputForBranch({ branch, model, tools: pi.getAllTools() });
			const payload: JsonObject = { ...event.payload, input };
			delete payload.messages;
			delete payload.previous_response_id;
			return payload;
		} catch (error) {
			ctx.abort();
			if (ctx.hasUI) {
				ctx.ui.notify(`OpenAI Codex request blocked: ${errorMessage(error)}`, "error");
			}
			const payload: JsonObject = { ...event.payload, input: [] };
			delete payload.messages;
			delete payload.previous_response_id;
			return payload;
		}
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const model = ctx.model;
		if (!isOpenAICodexModel(model)) return undefined;

		try {
			const sessionId = ctx.sessionManager.getSessionId();
			const branch = event.branchEntries as SessionEntry[];
			const input = effectiveInputForBranch({
				branch,
				model,
				tools: pi.getAllTools(),
				excludeLastAssistantError: event.reason === "overflow" && event.willRetry,
			});
			const cached = payloadShapeBySession.get(sessionId);
			const native = await withCompactionStatus(ctx, () => createNativeCheckpoint({
				ctx,
				model,
				input,
				basePayload: cached?.modelKey === modelKey(model) ? cached.payload : undefined,
				signal: event.signal,
			}));

			return {
				compaction: {
					summary: localMarker(),
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					usage: native.usage,
					details: native.details,
				},
			};
		} catch (error) {
			if (forcedCompaction?.sessionId === ctx.sessionManager.getSessionId()) {
				forcedCompaction = undefined;
			}
			if (!event.signal.aborted && ctx.hasUI) {
				ctx.ui.notify(`OpenAI Codex native compaction failed: ${errorMessage(error)}`, "error");
			}
			return { cancel: true };
		}
	});

	const continueAfterCompaction = (ctx: ExtensionContext, expected: ForcedCompactionState): void => {
		if (forcedCompaction !== expected) return;
		forcedCompaction = undefined;
		if (ctx.hasPendingMessages()) return;
		if (ctx.isIdle()) {
			pi.sendUserMessage(CONTINUATION_PROMPT);
		} else {
			pi.sendUserMessage(CONTINUATION_PROMPT, { deliverAs: "followUp" });
		}
	};

	pi.on("turn_end", (_event, ctx) => {
		if (forcedCompaction || !isOpenAICodexModel(ctx.model)) return;
		const config = loadConfig(ctx.cwd, ctx.isProjectTrusted());
		if (!config.autoCompact) return;

		const usage = ctx.getContextUsage();
		if (usage?.percent === null || usage?.percent === undefined) return;
		if (usage.percent < config.thresholdRatio * 100) return;

		forcedCompaction = {
			sessionId: ctx.sessionManager.getSessionId(),
			phase: "waitingForSettle",
		};
		if (ctx.hasUI) {
			ctx.ui.notify(
				`OpenAI Codex context reached ${usage.percent.toFixed(1)}%; stopping for compaction.`,
				"warning",
			);
		}
		ctx.abort();
	});

	pi.on("session_compact", (event, ctx) => {
		const state = forcedCompaction;
		const details = event.compactionEntry.details;
		if (
			!state
			|| state.phase !== "waitingForSettle"
			|| state.sessionId !== ctx.sessionManager.getSessionId()
			|| event.reason === "manual"
			|| !event.fromExtension
			|| !isOpenAICodexModel(ctx.model)
			|| !isJsonObject(details)
			|| details.kind !== NATIVE_COMPACTION_KIND
		) {
			return;
		}
		if (event.willRetry) {
			forcedCompaction = undefined;
			return;
		}
		forcedCompaction = { ...state, phase: "compacted" };
	});

	pi.on("agent_settled", (_event, ctx) => {
		const state = forcedCompaction;
		if (
			!state
			|| state.sessionId !== ctx.sessionManager.getSessionId()
			|| !isOpenAICodexModel(ctx.model)
		) {
			return;
		}
		if (state.phase === "compacted") {
			continueAfterCompaction(ctx, state);
			return;
		}
		if (state.phase !== "waitingForSettle") return;

		const compacting: ForcedCompactionState = { ...state, phase: "compacting" };
		forcedCompaction = compacting;
		ctx.compact({
			onComplete: () => continueAfterCompaction(ctx, compacting),
			onError: (error) => {
				if (forcedCompaction !== compacting) return;
				forcedCompaction = undefined;
				if (ctx.hasUI) {
					ctx.ui.notify(`OpenAI Codex compaction failed: ${error.message}`, "error");
				}
			},
		});
	});
}
