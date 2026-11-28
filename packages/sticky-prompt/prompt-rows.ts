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

type ChildLayout = {
  readonly children: readonly object[];
  readonly parts: readonly (readonly string[])[];
  readonly width: number;
};

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function stringLines(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return (value as readonly unknown[]).every((line) => typeof line === "string")
    ? (value as readonly string[])
    : undefined;
}

function partsOf(rawParts: unknown): readonly (readonly string[])[] | undefined {
  if (!Array.isArray(rawParts)) return undefined;
  const parts: (readonly string[])[] = [];
  for (const rawPart of rawParts as readonly unknown[]) {
    const part = stringLines(rawPart);
    if (part === undefined) return undefined;
    parts.push(part);
  }
  return parts;
}

function objectsOf(rawChildren: unknown): readonly object[] | undefined {
  if (!Array.isArray(rawChildren)) return undefined;
  const children = (rawChildren as readonly unknown[]).filter(isObject);
  return children.length === rawChildren.length ? children : undefined;
}

/**
 * The container's per-child line cache from its last render. pi-tui keeps it on `childLines` as
 * `{ width, children, parts, lines }`, and reuses the same object while children and their lines
 * stay the same.
 */
function childLayout(container: object): ChildLayout | undefined {
  const layout: unknown = Reflect.get(container, "childLines");
  if (!isObject(layout)) return undefined;
  const width: unknown = Reflect.get(layout, "width");
  if (typeof width !== "number") return undefined;
  const children = objectsOf(Reflect.get(layout, "children"));
  const parts = partsOf(Reflect.get(layout, "parts"));
  if (children === undefined || parts === undefined) return undefined;
  if (children.length !== parts.length) return undefined;
  return { children, parts, width };
}

/** Width of the container's last render, or undefined when it has not rendered yet. */
export function layoutWidth(container: object): number | undefined {
  return childLayout(container)?.width;
}

/** Line spans of the container's direct children from its last render at this width. */
export function childSpans(container: object, width: number): readonly Span[] | undefined {
  const layout = childLayout(container);
  if (layout?.width !== width) return undefined;
  const spans: Span[] = [];
  let start = 0;
  for (const [index, child] of layout.children.entries()) {
    const height = layout.parts[index]?.length ?? 0;
    spans.push({ component: child, end: start + height, start });
    start += height;
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
