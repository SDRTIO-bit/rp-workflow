import { describe, expect, it } from "vitest";
import { edgeDelayMs, motionStyle, nodeDelayMs } from "./motion";

describe("motion helpers", () => {
  it("creates small deterministic stagger delays", () => {
    expect(nodeDelayMs(0)).toBe(60);
    expect(nodeDelayMs(3)).toBe(180);
    expect(edgeDelayMs(0)).toBe(120);
    expect(edgeDelayMs(3)).toBe(300);
  });

  it("returns CSS custom properties for animation delays", () => {
    expect(motionStyle("--node-delay", 140)).toEqual({ "--node-delay": "140ms" });
  });
});
