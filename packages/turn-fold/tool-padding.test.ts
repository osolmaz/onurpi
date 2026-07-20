import { describe, expect, it, vi } from "vitest";

import { removeToolHorizontalPadding } from "./tool-padding.ts";

describe("tool horizontal padding", () => {
  it("removes and invalidates both built-in tool shells", () => {
    const boxInvalidate = vi.fn();
    const textInvalidate = vi.fn();
    const contentBox = { invalidate: boxInvalidate, paddingX: 1 };
    const contentText = { invalidate: textInvalidate, paddingX: 2 };
    const selfRenderContainer = { paddingX: 3 };

    expect(removeToolHorizontalPadding({ contentBox, contentText, selfRenderContainer })).toBe(2);
    expect(contentBox.paddingX).toBe(0);
    expect(contentText.paddingX).toBe(0);
    expect(selfRenderContainer.paddingX).toBe(3);
    expect(boxInvalidate).toHaveBeenCalledOnce();
    expect(boxInvalidate).toHaveBeenCalledWith();
    expect(textInvalidate).toHaveBeenCalledOnce();
    expect(textInvalidate).toHaveBeenCalledWith();
  });

  it("leaves zero or unsupported padding targets unchanged", () => {
    const zeroInvalidate = vi.fn();
    const zeroPadding = { invalidate: zeroInvalidate, paddingX: 0 };

    const stringInvalidate = vi.fn();
    const stringPadding = { invalidate: stringInvalidate, paddingX: "1" };
    const lockedInvalidate = vi.fn();
    const lockedPadding = { invalidate: lockedInvalidate, paddingX: 1 };
    Object.defineProperty(lockedPadding, "paddingX", { writable: false });

    expect(
      removeToolHorizontalPadding({
        contentBox: zeroPadding,
        contentText: stringPadding,
      }),
    ).toBe(0);
    expect(zeroPadding.paddingX).toBe(0);
    expect(zeroInvalidate).not.toHaveBeenCalled();
    expect(stringPadding.paddingX).toBe("1");
    expect(stringInvalidate).not.toHaveBeenCalled();
    expect(removeToolHorizontalPadding({ contentBox: null })).toBe(0);
    expect(removeToolHorizontalPadding({ contentBox: lockedPadding })).toBe(0);
    expect(lockedPadding.paddingX).toBe(1);
    expect(lockedInvalidate).not.toHaveBeenCalled();
    expect(removeToolHorizontalPadding({})).toBe(0);
  });
});
