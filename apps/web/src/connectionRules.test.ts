import { describe, expect, test } from "vitest";
import type { DataType, NodeCatalog, WorkflowDefinition } from "@awp/workflow-core";
import { evaluateConnection } from "./connectionRules";

const workflow: WorkflowDefinition = {
  id: "rules",
  name: "Rules",
  version: 1,
  nodes: [
    { id: "input", type: "userInput", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "agent", position: { x: 280, y: 0 }, config: {} },
    { id: "output", type: "textOutput", position: { x: 560, y: 0 }, config: {} },
    { id: "worldbook", type: "worldbookSearch", position: { x: 0, y: 220 }, config: {} },
    { id: "preview", type: "preview", position: { x: 840, y: 0 }, config: {} },
  ],
  edges: [],
};

describe("connectionRules", () => {
  test("allows compatible registry-defined ports", () => {
    expect(
      evaluateConnection(workflow, {
        source: "input",
        sourcePort: "text",
        target: "agent",
        targetPort: "context",
      }),
    ).toEqual({ ok: true });

    expect(
      evaluateConnection(workflow, {
        source: "worldbook",
        sourcePort: "results",
        target: "agent",
        targetPort: "context",
      }),
    ).toEqual({ ok: true });
  });

  test("blocks incompatible data types", () => {
    expect(
      evaluateConnection(workflow, {
        source: "input",
        sourcePort: "text",
        target: "output",
        targetPort: "text",
      }),
    ).toEqual({ ok: false, reason: "端口类型不兼容：用户输入 不能连接到 草稿。" });
  });

  test("blocks self connections and occupied input ports", () => {
    expect(
      evaluateConnection(workflow, {
        source: "agent",
        sourcePort: "result",
        target: "agent",
        targetPort: "context",
      }),
    ).toEqual({ ok: false, reason: "不能把节点连接到自己。" });

    expect(
      evaluateConnection(
        {
          ...workflow,
          edges: [
            {
              id: "existing",
              source: "input",
              sourcePort: "text",
              target: "agent",
              targetPort: "context",
            },
          ],
        },
        {
          source: "worldbook",
          sourcePort: "results",
          target: "agent",
          targetPort: "context",
        },
      ),
    ).toEqual({ ok: false, reason: "目标输入端口已经被占用。" });
  });

  test("allows preview nodes to inspect plugin data types", () => {
    const catalog: NodeCatalog = {
      memorySource: {
        type: "memorySource",
        label: "Memory Source",
        ports: [
          {
            id: "memories",
            label: "Memories",
            direction: "output",
            dataType: "memory" as DataType,
          },
        ],
      },
      preview: {
        type: "preview",
        label: "Preview",
        ports: [{ id: "data", label: "Data", direction: "input", dataType: "json" }],
      },
    };
    const pluginWorkflow: WorkflowDefinition = {
      id: "preview-plugin-data",
      name: "Preview plugin data",
      version: 1,
      nodes: [
        { id: "memory", type: "memorySource", position: { x: 0, y: 0 }, config: {} },
        { id: "preview", type: "preview", position: { x: 280, y: 0 }, config: {} },
      ],
      edges: [],
    };

    expect(
      evaluateConnection(
        pluginWorkflow,
        {
          source: "memory",
          sourcePort: "memories",
          target: "preview",
          targetPort: "data",
        },
        catalog,
      ),
    ).toEqual({ ok: true });
  });
});
