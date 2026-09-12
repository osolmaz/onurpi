/**
 * Request-time policy for images already in the session.
 *
 * Runs on the `context` hook, which sees a deep copy of the messages before each LLM call. When
 * the images in that copy exceed the budget, the oldest images become text notes. Nothing is
 * written to the session, so the transcript on disk stays complete while the outgoing request
 * stays inside the provider's body limit.
 */

import type { ContextEvent } from "@earendil-works/pi-coding-agent";

import {
  type ImageBudgetConfig,
  type ImageRef,
  REDACTED_MARKER,
  planRedactions,
  redactionNote,
} from "./image-budget.ts";

export type ContextMessages = ContextEvent["messages"];
export type ContextMessage = ContextMessages[number];
export type ImageMessage = Extract<ContextMessage, { role: "user" | "toolResult" }>;

type ImageSlot = {
  message: ImageMessage;
  index: number;
  bytes: number;
  mimeType: string;
  toolName: string | undefined;
};

export type ContextPolicyOutcome = {
  imageCount: number;
  bytesBefore: number;
  bytesAfter: number;
  redactCount: number;
};

function isImageMessage(message: ContextMessage): message is ImageMessage {
  return message.role === "user" || message.role === "toolResult";
}

function imageSlots(messages: ContextMessages): ImageSlot[] {
  const slots: ImageSlot[] = [];
  for (const message of messages) {
    if (!isImageMessage(message)) continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    const toolName = message.role === "toolResult" ? message.toolName : undefined;
    for (let index = 0; index < content.length; index += 1) {
      const block = content[index];
      if (block?.type !== "image") continue;
      slots.push({ message, index, bytes: block.data.length, mimeType: block.mimeType, toolName });
    }
  }
  return slots;
}

function replaceImage(slot: ImageSlot, text: string): void {
  const content = slot.message.content;
  if (!Array.isArray(content)) return;
  content[slot.index] = { type: "text", text };
}

function redactSlots(slots: readonly ImageSlot[], redactCount: number, budgetBytes: number): void {
  const refs: ImageRef[] = slots
    .slice(0, redactCount)
    .map((slot) => ({ bytes: slot.bytes, mimeType: slot.mimeType, toolName: slot.toolName }));
  const note = redactionNote(refs, slots.length - redactCount, budgetBytes);
  for (let position = 0; position < redactCount; position += 1) {
    const slot = slots[position];
    if (slot === undefined) continue;
    replaceImage(slot, position === 0 ? note : REDACTED_MARKER);
  }
}

export function applyContextPolicy(
  messages: ContextMessages,
  config: ImageBudgetConfig,
): ContextPolicyOutcome {
  const slots = imageSlots(messages);
  const plan = planRedactions(
    slots.map((slot) => slot.bytes),
    config,
  );
  if (plan.redactCount === 0) {
    return {
      imageCount: slots.length,
      bytesBefore: plan.bytesBefore,
      bytesAfter: plan.bytesBefore,
      redactCount: 0,
    };
  }
  redactSlots(slots, plan.redactCount, config.imageBudgetBytes);
  return {
    imageCount: slots.length,
    bytesBefore: plan.bytesBefore,
    bytesAfter: plan.bytesAfter,
    redactCount: plan.redactCount,
  };
}
