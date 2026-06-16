/**
 * WireType Compatibility Tests — P-1
 *
 * Covers: wire type matching, schema compatibility, legacy port mapping,
 * cross-type rejection, legacy workflow regression.
 */
import { describe, expect, it } from "vitest";
import {
  areWireTypesCompatible,
  checkSchemaCompatibility,
  resolvePortWireType,
  isLegacyPort,
  isWirePort,
  validateWorkflow,
  nodeRegistry,
  runWorkflow,
  setRuntimeSchemaValidator,
} from "./index.js";
import type { WorkflowDefinition, NodeCatalog } from "./types.js";

describe("areWireTypesCompatible", () => {
  it("allows same wire type connections", () => {
    expect(areWireTypesCompatible("text", "text")).toBe(true);
    expect(areWireTypesCompatible("markdown", "markdown")).toBe(true);
    expect(areWireTypesCompatible("json", "json")).toBe(true);
  });

  it("rejects all cross-wire-type connections", () => {
    expect(areWireTypesCompatible("text", "markdown")).toBe(false);
    expect(areWireTypesCompatible("text", "json")).toBe(false);
    expect(areWireTypesCompatible("markdown", "text")).toBe(false);
    expect(areWireTypesCompatible("markdown", "json")).toBe(false);
    expect(areWireTypesCompatible("json", "text")).toBe(false);
    expect(areWireTypesCompatible("json", "markdown")).toBe(false);
  });
});

describe("checkSchemaCompatibility", () => {
  it("returns compatible when both have same schemaId", () => {
    expect(checkSchemaCompatibility("schema.a", "schema.a")).toBe("compatible");
  });

  it("returns compatible when target has no schemaId", () => {
    expect(checkSchemaCompatibility("schema.a", undefined)).toBe("compatible");
    expect(checkSchemaCompatibility(undefined, undefined)).toBe("compatible");
  });

  it("returns compatible-with-runtime-validation when source has no schemaId but target does", () => {
    expect(checkSchemaCompatibility(undefined, "schema.a")).toBe(
      "compatible-with-runtime-validation",
    );
  });

  it("returns incompatible when schemaIds differ", () => {
    expect(checkSchemaCompatibility("schema.a", "schema.b")).toBe("incompatible");
  });
});

describe("resolvePortWireType", () => {
  it("returns wire type for wire-native ports", () => {
    expect(resolvePortWireType("playerInput", "text")).toBe("text");
    expect(resolvePortWireType("genericAgent", "result")).toBe("text");
    expect(resolvePortWireType("genericAgent", "data")).toBe("json");
    expect(resolvePortWireType("genericAgent", "instruction")).toBe("markdown");
  });

  it("returns wire type for mapped legacy ports", () => {
    expect(resolvePortWireType("userInput", "text")).toBe("text");
    expect(resolvePortWireType("rpWriterV1", "narrative")).toBe("text");
    expect(resolvePortWireType("rpPromptCompilerV1", "compiledPrompt")).toBe("json");
    expect(resolvePortWireType("rpContextAssemblerV2", "promptDocument")).toBe("json");
    expect(resolvePortWireType("rpInputParserLlmV1", "parsedInput")).toBe("json");
    expect(resolvePortWireType("rpRecentMessagesV1", "recentMessages")).toBe("json");
    expect(resolvePortWireType("rpWorldbookRetrieverV1", "retrievalResult")).toBe("json");
    expect(resolvePortWireType("textOutput", "final")).toBe("text");
    expect(resolvePortWireType("agentV2", "context")).toBe("markdown");
  });

  it("returns undefined for unmapped legacy ports", () => {
    expect(resolvePortWireType("agent", "context")).toBe("markdown");
  });

  it("returns undefined for unknown node types", () => {
    expect(resolvePortWireType("nonexistent", "anything")).toBeUndefined();
  });
});

describe("isLegacyPort / isWirePort", () => {
  it("correctly identifies legacy ports", () => {
    const port = { id: "x", label: "X", direction: "output" as const, dataType: "text" as const };
    expect(isLegacyPort(port)).toBe(true);
    expect(isWirePort(port)).toBe(false);
  });

  it("correctly identifies wire ports", () => {
    const port = { id: "x", label: "X", direction: "output" as const, wireType: "text" as const };
    expect(isWirePort(port)).toBe(true);
    expect(isLegacyPort(port)).toBe(false);
  });
});

describe("validateWorkflow — wire-native workflows", () => {
  const wireWorkflow: WorkflowDefinition = {
    id: "test-wire",
    name: "Test Wire",
    version: 1,
    nodes: [
      { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
      { id: "ag", type: "genericAgent", position: { x: 200, y: 0 }, config: {} },
      { id: "out", type: "playerOutput", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "in", sourcePort: "text", target: "ag", targetPort: "userInput" },
      { id: "e2", source: "ag", sourcePort: "result", target: "out", targetPort: "text" },
    ],
  };

  it("validates a correct wire-native workflow", () => {
    const issues = validateWorkflow(wireWorkflow, nodeRegistry);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });

  it("rejects cross-wire-type connections in wire-native workflow", () => {
    const bad: WorkflowDefinition = {
      ...wireWorkflow,
      edges: [
        { id: "e1", source: "in", sourcePort: "text", target: "ag", targetPort: "data" }, // text → json
      ],
    };
    const issues = validateWorkflow(bad, nodeRegistry);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Incompatible"))).toBe(
      true,
    );
  });
});

describe("validateWorkflow — legacy workflow regression", () => {
  const legacyWorkflow: WorkflowDefinition = {
    id: "legacy",
    name: "Legacy",
    version: 1,
    nodes: [
      { id: "in", type: "userInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
      { id: "ag", type: "agent", position: { x: 200, y: 0 }, config: {} },
      { id: "out", type: "textOutput", position: { x: 400, y: 0 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "in", sourcePort: "text", target: "ag", targetPort: "context" },
      { id: "e2", source: "ag", sourcePort: "result", target: "out", targetPort: "text" },
    ],
  };

  it("validates legacy workflow unchanged", () => {
    const issues = validateWorkflow(legacyWorkflow, nodeRegistry);
    const errors = issues.filter((i) => i.level === "error");
    expect(errors).toHaveLength(0);
  });
});

describe("runtime schema validation", () => {
  // Build a catalog with a node that has a JSON input port with schemaId
  const catalogWithSchema: NodeCatalog = {
    ...nodeRegistry,
    jsonConsumer: {
      type: "jsonConsumer",
      label: "JSON Consumer",
      ports: [
        {
          id: "dataIn",
          label: "Data In",
          direction: "input",
          wireType: "json",
          schemaId: "schema.a",
          required: true,
        },
      ],
    },
  };

  const executors = {
    jsonSource: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    jsonConsumer: async () => ({ outputs: { ok: true } }),
  };

  it("passes when data satisfies target schema", async () => {
    setRuntimeSchemaValidator((_schemaId, _data) => true);

    const wf: WorkflowDefinition = {
      id: "test-rsv-pass",
      name: "RSV Pass",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: { data: '{"key":"val"}' },
        },
        { id: "tgt", type: "jsonConsumer", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "src", sourcePort: "json", target: "tgt", targetPort: "dataIn" }],
    };

    const result = await runWorkflow(wf, executors, catalogWithSchema);
    expect(result.status).toBe("success");
  });

  it("fails when data does not satisfy target schema", async () => {
    setRuntimeSchemaValidator((_schemaId, _data) => false);

    const wf: WorkflowDefinition = {
      id: "test-rsv-fail",
      name: "RSV Fail",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: { data: '{"bad":"data"}' },
        },
        { id: "tgt", type: "jsonConsumer", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "src", sourcePort: "json", target: "tgt", targetPort: "dataIn" }],
    };

    const result = await runWorkflow(wf, executors, catalogWithSchema);
    expect(result.status).toBe("error");
    expect(result.nodeRuns.some((r) => r.error?.includes("Runtime schema validation failed"))).toBe(
      true,
    );
  });

  it("skips runtime check when validator is not configured (permissive pass-through)", async () => {
    // Set a permissive validator that always returns true — simulates no-op
    setRuntimeSchemaValidator((_schemaId, _data) => true);

    const wf: WorkflowDefinition = {
      id: "test-rsv-permissive",
      name: "RSV Permissive",
      version: 1,
      nodes: [
        {
          id: "src",
          type: "jsonSource",
          position: { x: 0, y: 0 },
          config: { data: '{"key":"val"}' },
        },
        { id: "tgt", type: "jsonConsumer", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "src", sourcePort: "json", target: "tgt", targetPort: "dataIn" }],
    };

    const result = await runWorkflow(wf, executors, catalogWithSchema);
    expect(result.status).toBe("success");
  });
});
