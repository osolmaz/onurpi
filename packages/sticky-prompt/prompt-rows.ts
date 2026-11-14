import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

export type PromptSpan = {
  readonly component: object;
  readonly end: number;
  readonly start: number;
};

type Span = {
  readonly component: object;
  readonly end: number;
  readonly start: number;
};

type LayoutChild = { readonly component: object; readonly height: number };
type MouseLayout = { readonly children: readonly LayoutChild[]; readonly width: number };

function layoutChild(value: unknown): LayoutChild | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const component: unknown = Reflect.get(value, "component");
  const height: unknown = Reflect.get(value, "height");
  if (typeof component !== "object" || component === null) return undefined;
  if (typeof height !== "number" || !Number.isFinite(height)) return undefined;
  return { component, height };
}

function mouseLayout(container: object): MouseLayout | undefined {
  const layout: unknown = Reflect.get(container, "mouseLayout");
  if (typeof layout !== "object" || layout === null) return undefined;
  const width: unknown = Reflect.get(layout, "width");
  const children: unknown = Reflect.get(layout, "children");
  if (typeof width !== "number" || !Array.isArray(children)) return undefined;
  const parsed: LayoutChild[] = [];
  for (const child of children as readonly unknown[]) {
    const entry = layoutChild(child);
    if (entry === undefined) return undefined;
    parsed.push(entry);
  }
  return { children: parsed, width };
}

/** Width of the container's last render, or undefined when it has not rendered yet. */
export function layoutWidth(container: object): number | undefined {
  return mouseLayout(container)?.width;
}

/** Line spans of the container's direct children from its last render at this width. */
export function childSpans(container: object, width: number): readonly Span[] | undefined {
  const layout = mouseLayout(container);
  if (layout?.width !== width) return undefined;
  const spans: Span[] = [];
  let start = 0;
  for (const child of layout.children) {
    spans.push({ component: child.component, end: start + child.height, start });
    start += child.height;
  }
  return spans;
}

function offsetSpans(spans: readonly Span[], offset: number): readonly PromptSpan[] {
  return spans.map((span) => ({
    component: span.component,
    end: span.end + offset,
    start: span.start + offset,
  }));
}

/** Line spans of every user prompt below the container, counted from its first line. */
export function promptSpans(container: Container, width: number): readonly PromptSpan[] {
  const spans = childSpans(container, width) ?? [];
  const found: PromptSpan[] = [];
  for (const span of spans) {
    if (span.component instanceof UserMessageComponent) found.push(span);
    else if (span.component instanceof Container)
      found.push(...offsetSpans(promptSpans(span.component, width), span.start));
  }
  return found;
}

/** Blank rows the header keeps above the next prompt, so the two never read as one block. */
const HEADER_GAP_ROWS = 2;

function nearNextPrompt(spans: readonly PromptSpan[], scrollTop: number): boolean {
  const next = spans.find((span) => span.start > scrollTop);
  return next !== undefined && next.start - scrollTop <= HEADER_GAP_ROWS;
}

/**
 * Prompt of the turn at the top of the viewport: the last prompt that ended above `scrollTop`.
 *
 * Returns undefined while any part of a prompt is still on screen, and also while the next prompt
 * sits less than two blank rows below the top. Either way the header would read as part of that
 * prompt, because the header and the message padding behind it share one background.
 */
export function promptAt(spans: readonly PromptSpan[], scrollTop: number): PromptSpan | undefined {
  if (!Number.isFinite(scrollTop)) return undefined;
  let chosen: PromptSpan | undefined;
  for (const span of spans) {
    if (span.end <= scrollTop) {
      chosen = span;
      continue;
    }
    if (span.start > scrollTop) break;
    return undefined;
  }
  if (chosen === undefined) return undefined;
  if (nearNextPrompt(spans, scrollTop)) return undefined;
  return chosen;
}
