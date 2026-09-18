/**
 * Stateful session policy.
 *
 * Keeps the config load, the image cache, and the counters in one place with narrow types, so
 * `index.ts` stays a thin set of Pi hooks. This file calls no Pi runtime API: the hooks hand it
 * plain content, messages, and contexts.
 */

import type { resizeImage } from "@earendil-works/pi-coding-agent";

import { ImageCache } from "./cache.ts";
import { handleSessionPolicyCommand, type SessionPolicySnapshot } from "./command.ts";
import { configPath, readConfig, type ConfigLoad, type SessionPolicyConfig } from "./config.ts";
import {
  applyContextPolicy,
  applyInsertPolicy,
  collectMarkerHashes,
  type ContextMessages,
  type ToolResultContent,
} from "./policy.ts";

export type UiContext = {
  hasUI: boolean;
  ui: { notify: (message: string, type?: "info" | "warning" | "error") => void };
};

export type SessionPolicyDeps = {
  agentDir: string;
  resize: typeof resizeImage;
};

/** The source path comes from the tool input when the tool has one. */
export function sourcePath(input: Record<string, unknown>): string | undefined {
  const value = input["path"];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export class SessionPolicy {
  private load: ConfigLoad;
  private readonly cache: ImageCache;
  private liveMarkers = 0;
  private ejected = 0;
  private missingNotified = false;

  constructor(private readonly deps: SessionPolicyDeps) {
    this.load = readConfig(configPath(deps.agentDir));
    this.cache = new ImageCache(this.load.config.cacheMaxBytes);
  }

  get path(): string {
    return configPath(this.deps.agentDir);
  }

  get config(): SessionPolicyConfig {
    return this.load.config;
  }

  snapshot(): SessionPolicySnapshot {
    return {
      configPath: this.path,
      config: this.config,
      errors: this.load.errors,
      cacheBytes: this.cache.bytes,
      cacheCount: this.cache.count,
      liveMarkers: this.liveMarkers,
      ejected: this.ejected,
    };
  }

  reload(): readonly string[] {
    this.load = readConfig(this.path);
    this.cache.setLimit(this.load.config.cacheMaxBytes);
    return this.load.errors;
  }

  onSessionStart(ctx: UiContext): void {
    const errors = this.reload();
    this.reset();
    if (ctx.hasUI && errors.length > 0) {
      ctx.ui.notify(`session-policy: ${errors.join("; ")}`, "warning");
    }
  }

  onSessionShutdown(): void {
    this.reset();
  }

  /** Replace every image payload with a marker and cache the payload in memory. */
  async onToolResult(
    content: ToolResultContent,
    input: Record<string, unknown>,
  ): Promise<{ content: ToolResultContent } | undefined> {
    if (!this.config.enabled) return undefined;
    const outcome = await applyInsertPolicy(
      content,
      this.config,
      this.deps.resize,
      sourcePath(input),
    );
    if (!outcome.changed) return undefined;
    for (const image of outcome.captured) {
      this.cache.set(image.hash, { data: image.data, mimeType: image.mimeType });
    }
    this.ejected += outcome.captured.length;
    return { content: outcome.content };
  }

  /** Put cached pictures back after their markers for the model call only. */
  onContext(messages: ContextMessages, ctx: UiContext): { messages: ContextMessages } | undefined {
    if (!this.config.enabled) return undefined;
    const outcome = applyContextPolicy(messages, (hash) => this.cache.get(hash));
    this.liveMarkers = outcome.liveMarkers;
    this.notifyMissing(outcome.missing, ctx);
    return outcome.changed ? { messages: outcome.messages } : undefined;
  }

  /** Drop cache entries that no live marker references any more. */
  onLiveMessages(messages: ContextMessages): number {
    const live = collectMarkerHashes(messages);
    this.liveMarkers = live.size;
    return this.cache.retain(live);
  }

  command(args: string, ctx: UiContext): void {
    handleSessionPolicyCommand(
      args,
      { reload: () => this.reload(), snapshot: () => this.snapshot() },
      ctx,
    );
  }

  private reset(): void {
    this.cache.clear();
    this.liveMarkers = 0;
    this.ejected = 0;
    this.missingNotified = false;
  }

  private notifyMissing(missing: number, ctx: UiContext): void {
    if (missing === 0 || this.missingNotified || !this.config.notify || !ctx.hasUI) return;
    ctx.ui.notify(
      `session-policy: ${String(missing)} live image${missing === 1 ? " is" : "s are"} no longer cached, because the cache is memory only. Re-read the source path to see ${missing === 1 ? "it" : "them"} again.`,
      "info",
    );
    this.missingNotified = true;
  }
}
