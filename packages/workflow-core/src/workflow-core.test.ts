import { describe, expect, it } from "vitest";
import { createExecutionBatches, runWorkflow, validateWorkflow } from "./index";
import type { NodeCatalog, WorkflowDefinition } from "./types";

const simpleWorkflow: WorkflowDefinition = {
  id: "wf_simple",
  name: "Simple",
  version: 1,
  nodes: [
    { id: "input", type: "userInput", position: { x: 0, y: 0 }, config: { text: "hello" } },
    { id: "agent", type: "agent", position: { x: 260, y: 0 }, config: {} },
    { id: "output", type: "textOutput", position: { x: 520, y: 0 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "input", sourcePort: "text", target: "agent", targetPort: "context" },
    { id: "e2", source: "agent", sourcePort: "result", target: "output", targetPort: "text" },
  ],
};

describe("workflow core", () => {
  it("validates a simple workflow", () => {
    expect(validateWorkflow(simpleWorkflow)).toEqual([]);
  });

  it("detects invalid edges", () => {
    const issues = validateWorkflow({
      ...simpleWorkflow,
      edges: [
        { id: "bad", source: "missing", sourcePort: "x", target: "agent", targetPort: "context" },
      ],
    });

    expect(issues[0]?.message).toContain("Missing source node");
  });

  it("detects cycles", () => {
    const issues = validateWorkflow({
      ...simpleWorkflow,
      edges: [
        ...simpleWorkflow.edges,
        {
          id: "cycle",
          source: "output",
          sourcePort: "final",
          target: "agent",
          targetPort: "context",
        },
      ],
    });

    expect(issues.some((issue) => issue.message.includes("cycle"))).toBe(true);
  });

  it("creates parallel batches for fan-out and fan-in", () => {
    const workflow: WorkflowDefinition = {
      id: "wf_parallel",
      name: "Parallel",
      version: 1,
      nodes: [
        { id: "input", type: "userInput", position: { x: 0, y: 0 }, config: {} },
        { id: "a", type: "agent", position: { x: 260, y: -80 }, config: {} },
        { id: "b", type: "agent", position: { x: 260, y: 80 }, config: {} },
        { id: "merge", type: "agent", position: { x: 520, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "input", sourcePort: "text", target: "a", targetPort: "context" },
        { id: "e2", source: "input", sourcePort: "text", target: "b", targetPort: "context" },
        { id: "e3", source: "a", sourcePort: "result", target: "merge", targetPort: "context" },
        { id: "e4", source: "b", sourcePort: "result", target: "merge", targetPort: "instruction" },
      ],
    };

    expect(createExecutionBatches(workflow)).toEqual([["input"], ["a", "b"], ["merge"]]);
  });

  it("runs a workflow and records node outputs", async () => {
    const result = await runWorkflow(simpleWorkflow, {
      userInput: async ({ node }) => ({ outputs: { text: node.config.text } }),
      agent: async ({ inputs }) => ({ outputs: { result: `agent:${inputs.context}` } }),
      textOutput: async ({ inputs }) => ({ outputs: { final: inputs.text } }),
    });

    expect(result.status).toBe("success");
    expect(result.nodeRuns.at(-1)?.outputs.final).toBe("agent:hello");
  });

  it("validates workflows against an injected node catalog", () => {
    const catalog: NodeCatalog = {
      customInput: {
        type: "customInput",
        label: "Custom Input",
        ports: [{ id: "text", label: "Text", dataType: "text", direction: "output" }],
      },
      customOutput: {
        type: "customOutput",
        label: "Custom Output",
        ports: [{ id: "text", label: "Text", dataType: "text", direction: "input" }],
      },
    };
    const workflow: WorkflowDefinition = {
      id: "custom",
      name: "Custom catalog",
      version: 1,
      nodes: [
        { id: "a", type: "customInput", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "customOutput", position: { x: 240, y: 0 }, config: {} },
      ],
      edges: [{ id: "edge", source: "a", sourcePort: "text", target: "b", targetPort: "text" }],
    };

    expect(validateWorkflow(workflow)).toEqual([
      { level: "error", message: "Unknown node type: customInput", nodeId: "a" },
      { level: "error", message: "Unknown node type: customOutput", nodeId: "b" },
      {
        level: "error",
        message: "Missing output port: text",
        edgeId: "edge",
        nodeId: "a",
        portId: "text",
      },
    ]);
    expect(validateWorkflow(workflow, catalog)).toEqual([]);
  });

  it("runs workflows against an injected node catalog", async () => {
    const catalog: NodeCatalog = {
      pluginInput: {
        type: "pluginInput",
        label: "Plugin Input",
        ports: [{ id: "text", label: "Text", dataType: "text", direction: "output" }],
      },
      pluginOutput: {
        type: "pluginOutput",
        label: "Plugin Output",
        ports: [{ id: "text", label: "Text", dataType: "text", direction: "input" }],
      },
    };
    const workflow: WorkflowDefinition = {
      id: "plugin-run",
      name: "Plugin Run",
      version: 1,
      nodes: [
        { id: "a", type: "pluginInput", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "pluginOutput", position: { x: 240, y: 0 }, config: {} },
      ],
      edges: [{ id: "edge", source: "a", sourcePort: "text", target: "b", targetPort: "text" }],
    };

    const result = await runWorkflow(
      workflow,
      {
        pluginInput: async () => ({ outputs: { text: "from-plugin" } }),
        pluginOutput: async ({ inputs }) => ({ outputs: { final: inputs.text } }),
      },
      catalog,
    );

    expect(result.status).toBe("success");
    expect(result.nodeRuns.at(-1)?.outputs.final).toBe("from-plugin");
  });
});
