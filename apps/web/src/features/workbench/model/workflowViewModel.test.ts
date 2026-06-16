import { describe, expect, it } from "vitest";
import type { NodeCatalog, WorkflowDefinition } from "@awp/workflow-core";
import { createWorkflowViewModel } from "./workflowViewModel";

const catalog: NodeCatalog = {
  source: {
    type: "source",
    label: "Very Long Source Node Name That Should Be Preserved",
    category: "core",
    defaultConfig: { text: "hello", hidden: "ignored" },
    configFields: [{ key: "text", label: { zh: "文本", en: "Text" }, kind: "text" }],
    ports: [{ id: "out", label: "Long Output Port", direction: "output", wireType: "text" }],
  },
  target: {
    type: "target",
    label: "Target",
    category: "utility",
    ports: [{ id: "in", label: "Input", direction: "input", wireType: "text" }],
  },
};

const workflow: WorkflowDefinition = {
  id: "wf",
  name: "Workflow",
  version: 1,
  nodes: [
    { id: "a", type: "source", position: { x: 10, y: 20 }, config: { text: "hello" } },
    { id: "b", type: "target", position: { x: 320, y: 20 }, config: {} },
  ],
  edges: [{ id: "e1", source: "a", sourcePort: "out", target: "b", targetPort: "in" }],
};

describe("workflow view model", () => {
  it("builds node cards with separated input and output ports", () => {
    const model = createWorkflowViewModel(workflow, catalog, []);

    expect(model.nodes).toHaveLength(2);
    expect(model.nodes[0]!).toMatchObject({
      id: "a",
      title: "Very Long Source Node Name That Should Be Preserved",
      category: "core",
      position: { x: 10, y: 20 },
    });
    expect(model.nodes[0]!.inputs).toEqual([]);
    expect(model.nodes[0]!.outputs.map((port) => port.id)).toEqual(["out"]);
  });

  it("attaches run status to nodes without mutating the workflow", () => {
    const model = createWorkflowViewModel(workflow, catalog, [
      {
        nodeId: "a",
        status: "success",
        inputs: {},
        outputs: { out: "ok" },
        startedAt: 1,
        endedAt: 2,
      },
    ]);

    expect(model.nodes[0]!.runStatus).toBe("success");
    expect(workflow.nodes[0]!.config).toEqual({ text: "hello" });
  });

  it("drops edges that reference missing nodes or ports", () => {
    const model = createWorkflowViewModel(
      {
        ...workflow,
        edges: [
          ...workflow.edges,
          { id: "bad", source: "missing", sourcePort: "x", target: "b", targetPort: "in" },
        ],
      },
      catalog,
      [],
    );

    expect(model.edges.map((edge) => edge.id)).toEqual(["e1"]);
    expect(model.edges[0]!.visualClass).toBe("wire-text");
  });
});
