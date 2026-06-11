import { nodeRegistry, type DataType } from "@awp/workflow-core";
import { describe, expect, test } from "vitest";
import { dataTypePresentation, getNodePorts } from "./portPresentation";

const dataTypes: DataType[] = [
  "text",
  "user_input",
  "context",
  "search_result",
  "analysis",
  "draft",
  "final_text",
  "debug_info",
  "json",
  "memory",
];

describe("portPresentation", () => {
  test("defines a color and Chinese label for every data type", () => {
    for (const dataType of dataTypes) {
      const presentation = dataTypePresentation[dataType];

      expect(presentation.labelZh).not.toBe("");
      expect(presentation.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("reads input and output ports from the node registry", () => {
    expect(getNodePorts("agent", "input").map((port) => port.id)).toEqual([
      "context",
      "instruction",
    ]);
    expect(getNodePorts("agent", "output").map((port) => port.id)).toEqual(["result"]);
    expect(getNodePorts("missing", "input")).toEqual([]);
    expect(nodeRegistry.agent?.ports.length).toBeGreaterThan(0);
  });
});
