import { describe, expect, it } from "vitest";
import type { PortDefinition } from "@awp/workflow-core";
import { getEdgeVisualClass, getEdgeVisualLabel } from "./edgeVisuals";

const wire = (wireType: "json" | "markdown" | "text"): PortDefinition => ({
  id: wireType,
  label: wireType,
  direction: "output",
  wireType,
});

const legacy = (dataType: "draft" | "debug_info" | "json"): PortDefinition => ({
  id: dataType,
  label: dataType,
  direction: "output",
  dataType,
});

describe("edge visuals", () => {
  it("maps the three wire-native data lines to stable classes and labels", () => {
    expect(getEdgeVisualClass(wire("json"))).toBe("wire-json");
    expect(getEdgeVisualLabel(wire("json"))).toBe("JSON");
    expect(getEdgeVisualClass(wire("markdown"))).toBe("wire-markdown");
    expect(getEdgeVisualLabel(wire("markdown"))).toBe("Markdown");
    expect(getEdgeVisualClass(wire("text"))).toBe("wire-text");
    expect(getEdgeVisualLabel(wire("text"))).toBe("Text");
  });

  it("maps legacy ports without inventing workflow edge kinds", () => {
    expect(getEdgeVisualClass(legacy("draft"))).toBe("legacy-draft");
    expect(getEdgeVisualClass(legacy("debug_info"))).toBe("legacy-debug");
    expect(getEdgeVisualClass(legacy("json"))).toBe("legacy-json");
  });
});
