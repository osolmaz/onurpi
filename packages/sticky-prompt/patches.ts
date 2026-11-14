import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, ScrollView } from "@earendil-works/pi-tui";

import { headerSource, styledHeader } from "./header.ts";
import { promptAt, promptSpans } from "./prompt-rows.ts";

/**
 * Pi TUI layout marker. It is a global symbol, so the extension reaches the same property as the
 * layout engine without importing a private module.
 */
const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export type RestorePromptHeaderPatches = () => void;

type ScrollViewLike = { readonly scrollTop: number };
type ScrollNode = { readonly component: object; readonly state: object };

function isScrollViewLike(value: unknown): value is ScrollViewLike {
  if (typeof value !== "object" || value === null) return false;
  const scrollTop: unknown = Reflect.get(value, "scrollTop");
  return typeof scrollTop === "number";
}

function scrollNodeOf(value: unknown): ScrollNode | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const component: unknown = Reflect.get(value, "component");
  const state: unknown = Reflect.get(value, "state");
  if (typeof component !== "object" || component === null) return undefined;
  if (typeof state !== "object" || state === null) return undefined;
  return { component, state };
}

function promptText(component: object): unknown {
  const text: unknown = Reflect.get(component, "text");
  return typeof text === "string" ? text : Reflect.get(component, "message");
}

function headerAt(
  container: Container,
  scrollTop: number,
  width: number,
  theme: Theme | undefined,
): string | undefined {
  const span = promptAt(promptSpans(container, width), scrollTop);
  if (span === undefined) return undefined;
  const source = headerSource(promptText(span.component));
  return source === undefined ? undefined : styledHeader(source, width, theme);
}

function withHeader(
  lines: readonly string[],
  header: string | undefined,
  scrollTop: number,
): string[] {
  const index = Math.min(Math.max(Math.trunc(scrollTop), 0), lines.length - 1);
  const existing = lines[index];
  const next = [...lines];
  if (existing !== undefined) next[index] = header ?? existing;
  return next;
}

/**
 * Replace the first visible transcript line with the prompt of the turn behind it.
 *
 * The layout engine draws the transcript from `scrollTop`, so overwriting the content line at that
 * index puts the header at the top of the viewport without changing any height or scroll range.
 */
export function installPromptHeaderPatches(
  getTheme: () => Theme | undefined,
): RestorePromptHeaderPatches {
  const scrollPrototype = ScrollView.prototype as unknown as Record<symbol, unknown>;
  const originalNode: unknown = scrollPrototype[LAYOUT_NODE];
  const originalNodeCall =
    typeof originalNode === "function" ? (originalNode as (this: unknown) => unknown) : undefined;
  const scrollByContent = new WeakMap<object, ScrollViewLike>();

  const patchedNode = function (this: unknown): unknown {
    const node = originalNodeCall?.call(this);
    const parsed = scrollNodeOf(node);
    if (parsed !== undefined && isScrollViewLike(parsed.state)) {
      scrollByContent.set(parsed.component, parsed.state);
    }
    return node;
  };

  const containerPrototype = Container.prototype;
  const originalRender = containerPrototype.render;
  const patchedRender = function (this: Container, width: number): string[] {
    const lines = originalRender.call(this, width);
    const scrollTop = scrollByContent.get(this)?.scrollTop;
    if (scrollTop === undefined || lines.length === 0) return lines;
    const header = headerAt(this, scrollTop, width, getTheme());
    if (header === undefined) return lines;
    return withHeader(lines, header, scrollTop);
  };

  scrollPrototype[LAYOUT_NODE] = patchedNode;
  containerPrototype.render = patchedRender;

  return () => {
    if (scrollPrototype[LAYOUT_NODE] === patchedNode) scrollPrototype[LAYOUT_NODE] = originalNode;
    if (containerPrototype.render === patchedRender) containerPrototype.render = originalRender;
  };
}
