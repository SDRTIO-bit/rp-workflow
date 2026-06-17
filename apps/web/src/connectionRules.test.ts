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

  test("blocks JSON schema mismatches for legacy and wire-native ports", () => {
    const catalog: NodeCatalog = {
      legacySource: {
        type: "legacySource",
        label: "Legacy Source",
        ports: [
          {
            id: "json",
            label: "JSON",
            direction: "output",
            dataType: "json",
            schemaId: "schema:a",
          },
        ],
      },
      legacyTarget: {
        type: "legacyTarget",
        label: "Legacy Target",
        ports: [
          {
            id: "json",
            label: "JSON",
            direction: "input",
            dataType: "json",
            schemaId: "schema:b",
          },
        ],
      },
      wireSource: {
        type: "wireSource",
        label: "Wire Source",
        ports: [
          {
            id: "json",
            label: "JSON",
            direction: "output",
            wireType: "json",
            schemaId: "schema:a",
          },
        ],
      },
      wireTarget: {
        type: "wireTarget",
        label: "Wire Target",
        ports: [
          {
            id: "json",
            label: "JSON",
            direction: "input",
            wireType: "json",
            schemaId: "schema:b",
          },
        ],
      },
    };
    const schemaWorkflow: WorkflowDefinition = {
      id: "schema-rules",
      name: "Schema rules",
      version: 1,
      nodes: [
        { id: "legacySource", type: "legacySource", position: { x: 0, y: 0 }, config: {} },
        { id: "legacyTarget", type: "legacyTarget", position: { x: 280, y: 0 }, config: {} },
        { id: "wireSource", type: "wireSource", position: { x: 0, y: 220 }, config: {} },
        { id: "wireTarget", type: "wireTarget", position: { x: 280, y: 220 }, config: {} },
      ],
      edges: [],
    };

    expect(
      evaluateConnection(
        schemaWorkflow,
        {
          source: "legacySource",
          sourcePort: "json",
          target: "legacyTarget",
          targetPort: "json",
        },
        catalog,
      ),
    ).toEqual({ ok: false, reason: "端口类型不兼容：JSON 不能连接到 JSON。" });

    expect(
      evaluateConnection(
        schemaWorkflow,
        {
          source: "wireSource",
          sourcePort: "json",
          target: "wireTarget",
          targetPort: "json",
        },
        catalog,
      ),
    ).toEqual({ ok: false, reason: "端口类型不兼容：JSON (Wire) 不能连接到 JSON (Wire)。" });
  });
});
