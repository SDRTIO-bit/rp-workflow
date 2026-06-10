import { describe, expect, test } from "vitest";
import {
  clampScale,
  screenToWorld,
  worldToScreen,
  zoomViewportAtPoint,
  type Viewport,
} from "./canvasMath";

describe("canvasMath", () => {
  test("converts between screen and world coordinates", () => {
    const viewport: Viewport = { x: 20, y: -10, scale: 2 };

    expect(screenToWorld({ x: 100, y: 50 }, viewport)).toEqual({ x: 40, y: 30 });
    expect(worldToScreen({ x: 40, y: 30 }, viewport)).toEqual({ x: 100, y: 50 });
  });

  test("keeps the zoom anchor fixed under the pointer", () => {
    const before: Viewport = { x: 40, y: 30, scale: 1 };
    const anchor = { x: 240, y: 180 };
    const worldBefore = screenToWorld(anchor, before);

    const after = zoomViewportAtPoint(before, anchor, 2);

    expect(screenToWorld(anchor, after)).toEqual(worldBefore);
    expect(after.scale).toBe(2);
  });

  test("clamps scale to the supported canvas range", () => {
    expect(clampScale(0.05)).toBe(0.25);
    expect(clampScale(1.25)).toBe(1.25);
    expect(clampScale(6)).toBe(2.5);
  });
});
