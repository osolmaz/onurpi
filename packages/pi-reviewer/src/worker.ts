#!/usr/bin/env node
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

import {
  canonicalModelsStorePath,
  registerHuggingFaceOAuthProvider,
} from "./huggingface-provider.js";
import { terminalText } from "./terminal-text.js";
import { readWorkerRequest, type ReviewWorkerRequest } from "./worker-protocol.js";

type ReviewWorkerExecution = {
  readonly subscribe: (listener: (event: AgentSessionEvent) => void) => () => void;
  readonly prompt: (prompt: string) => Promise<void>;
  readonly dispose: () => void;
  readonly flush: () => Promise<void>;
};

type ReviewWorkerExecutionFactory = (
  request: ReviewWorkerRequest,
) => Promise<ReviewWorkerExecution>;

export async function runReviewWorker(
  request: ReviewWorkerRequest,
  createExecution: ReviewWorkerExecutionFactory = createDefaultExecution,
): Promise<void> {
  const execution = await createExecution(request);
  const unsubscribe = execution.subscribe(writeEvent);
  try {
    await execution.prompt(request.prompt);
  } finally {
    unsubscribe();
    execution.dispose();
    await execution.flush();
  }
}

export async function createDefaultExecution(
  request: ReviewWorkerRequest,
): Promise<ReviewWorkerExecution> {
  const modelRuntime = await ModelRuntime.create({
    authPath: request.authPath,
    modelsPath: request.modelsPath,
    modelsStorePath: canonicalModelsStorePath(request.authPath),
    allowModelNetwork: false,
  });
  if (!request.customModel) await registerHuggingFaceOAuthProvider(modelRuntime);
  const model = modelRuntime.getModel(request.provider, request.model);
  if (model === undefined) {
    throw new Error(`review model not found: ${request.provider}/${request.model}`);
  }
  if (!(await modelRuntime.checkAuth(request.provider))) {
    throw new Error(`no authentication for review provider ${request.provider}`);
  }

  const settingsManager = SettingsManager.create(request.cwd, request.configDir, {
    projectTrusted: false,
  });
  const resourceLoader = new DefaultResourceLoader({
    cwd: request.cwd,
    agentDir: request.configDir,
    settingsManager,
    additionalExtensionPaths: [request.extensionPath],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: request.systemPrompt,
  });
  await resourceLoader.reload();
  const extensionErrors = resourceLoader.getExtensions().errors;
  if (extensionErrors.length > 0) {
    throw new Error(
      `review extension failed to load: ${extensionErrors.map((entry) => entry.error).join("; ")}`,
    );
  }

  const { session } = await createAgentSession({
    cwd: request.cwd,
    agentDir: request.configDir,
    modelRuntime,
    model,
    thinkingLevel: request.thinking,
    tools: [...request.tools],
    resourceLoader,
    settingsManager,
    sessionManager: SessionManager.inMemory(request.cwd),
  });
  const removeRequestLimiter = installRequestLimiter(session, request.maxModelRequests);
  return {
    subscribe: (listener) => session.subscribe(listener),
    prompt: async (prompt) => {
      await session.prompt(prompt);
    },
    dispose: () => {
      removeRequestLimiter();
      session.dispose();
    },
    flush: async () => {
      await settingsManager.flush();
    },
  };
}

export function installRequestLimiter(
  session: Pick<AgentSession, "subscribe" | "sendUserMessage">,
  limit: number | null,
): () => void {
  if (limit === null) return () => undefined;
  let requests = 0;
  let steered = false;
  return session.subscribe((event) => {
    if (event.type !== "message_end" || event.message.role !== "assistant") return;
    requests += 1;
    if (steered || requests < limit || event.message.stopReason !== "toolUse") return;
    steered = true;
    void session
      .sendUserMessage(
        "Stop investigating now. Return the final review JSON object in the required schema using the evidence already gathered. Do not call more tools.",
        { deliverAs: "steer" },
      )
      .catch((error: unknown) => {
        process.stderr.write(
          `${terminalText(`could not steer review to completion: ${error instanceof Error ? error.message : String(error)}`)}\n`,
        );
      });
  });
}

function writeEvent(event: AgentSessionEvent): void {
  if (event.type === "message_end") {
    writeJson(workerMessagePayload(event.message));
    return;
  }
  if (event.type === "agent_end") {
    writeJson({ type: "agent_end", messages: [] });
    return;
  }
  writeJson({ type: event.type });
}

export function workerMessagePayload(
  message: Readonly<{ role: string }>,
): Readonly<Record<string, unknown>> {
  return message.role === "assistant" ? { type: "message_end", message } : { type: "message_end" };
}

function writeJson(value: Readonly<Record<string, unknown>>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function main(): Promise<void> {
  try {
    await runReviewWorker(await readWorkerRequest());
  } catch (error) {
    process.stderr.write(
      `${terminalText(error instanceof Error ? error.message : String(error))}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.env["PI_REVIEWER_WORKER"] === "1") await main();
