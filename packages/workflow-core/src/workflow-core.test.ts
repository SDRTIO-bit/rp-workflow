import { describe, expect, it } from "vitest";
import { areTypesCompatible, createExecutionBatches, runWorkflow, validateWorkflow } from "./index";
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

describe("schemaId compatibility", () => {
  it("allows same schemaId on both ends", () => {
    expect(areTypesCompatible("json", "json", "rp.parsed-input.v1", "rp.parsed-input.v1")).toBe(
      true,
    );
  });

  it("rejects different schemaIds", () => {
    expect(areTypesCompatible("json", "json", "rp.parsed-input.v1", "rp.lore.v1")).toBe(false);
  });

  it("allows typed json output to plain json input (downgrade)", () => {
    expect(areTypesCompatible("json", "json", "rp.parsed-input.v1", undefined)).toBe(true);
  });

  it("rejects plain json output to typed json input", () => {
    expect(areTypesCompatible("json", "json", undefined, "rp.parsed-input.v1")).toBe(false);
  });

  it("rejects non-json source to typed json target", () => {
    expect(areTypesCompatible("text", "json", undefined, "rp.parsed-input.v1")).toBe(false);
  });

  it("rejects typed json source to non-json target", () => {
    expect(areTypesCompatible("json", "text", "rp.parsed-input.v1", undefined)).toBe(false);
  });

  it("preserves original behavior when no schemaId", () => {
    expect(areTypesCompatible("json", "json")).toBe(true);
    expect(areTypesCompatible("text", "context")).toBe(true);
    expect(areTypesCompatible("draft", "final_text")).toBe(true);
    expect(areTypesCompatible("text", "draft")).toBe(false);
  });

  it("reports schemaId in validation error messages", () => {
    const catalog: NodeCatalog = {
      typedOut: {
        type: "typedOut",
        label: "Typed Out",
        ports: [
          {
            id: "data",
            label: "Data",
            dataType: "json",
            direction: "output",
            schemaId: "rp.parsed-input.v1",
          },
        ],
      },
      typedIn: {
        type: "typedIn",
        label: "Typed In",
        ports: [
          {
            id: "data",
            label: "Data",
            dataType: "json",
            direction: "input",
            schemaId: "rp.lore.v1",
          },
        ],
      },
    };
    const workflow: WorkflowDefinition = {
      id: "schema-mismatch",
      name: "Schema Mismatch",
      version: 1,
      nodes: [
        { id: "a", type: "typedOut", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "typedIn", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "a", sourcePort: "data", target: "b", targetPort: "data" }],
    };

    const issues = validateWorkflow(workflow, catalog);
    const typeIssue = issues.find((i) => i.message.includes("Incompatible"));
    expect(typeIssue).toBeDefined();
    expect(typeIssue?.message).toContain("rp.parsed-input.v1");
    expect(typeIssue?.message).toContain("rp.lore.v1");
  });

  it("rejects schemaId on non-json port", () => {
    const catalog: NodeCatalog = {
      badNode: {
        type: "badNode",
        label: "Bad Node",
        ports: [
          {
            id: "data",
            label: "Data",
            dataType: "text",
            direction: "output",
            schemaId: "rp.parsed-input.v1",
          },
        ],
      },
      sink: {
        type: "sink",
        label: "Sink",
        ports: [{ id: "data", label: "Data", dataType: "text", direction: "input" }],
      },
    };
    const workflow: WorkflowDefinition = {
      id: "bad-schema",
      name: "Bad Schema",
      version: 1,
      nodes: [
        { id: "a", type: "badNode", position: { x: 0, y: 0 }, config: {} },
        { id: "b", type: "sink", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "a", sourcePort: "data", target: "b", targetPort: "data" }],
    };

    const issues = validateWorkflow(workflow, catalog);
    expect(issues.some((i) => i.message.includes("schemaId") && i.message.includes("json"))).toBe(
      true,
    );
  });
});

describe("WorkflowRunContext", () => {
  const ctxCatalog: NodeCatalog = {
    ctxInput: {
      type: "ctxInput",
      label: "Context Input",
      ports: [{ id: "text", label: "Text", dataType: "text", direction: "output" }],
    },
    ctxOutput: {
      type: "ctxOutput",
      label: "Context Output",
      ports: [{ id: "text", label: "Text", dataType: "text", direction: "input" }],
    },
  };

  const ctxWorkflow: WorkflowDefinition = {
    id: "ctx-wf",
    name: "Context Workflow",
    version: 1,
    nodes: [
      { id: "a", type: "ctxInput", position: { x: 0, y: 0 }, config: {} },
      { id: "b", type: "ctxOutput", position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: "e1", source: "a", sourcePort: "text", target: "b", targetPort: "text" }],
  };

  it("runs without context (backward compatible)", async () => {
    const result = await runWorkflow(
      ctxWorkflow,
      {
        ctxInput: async () => ({ outputs: { text: "hi" } }),
        ctxOutput: async ({ inputs }) => ({ outputs: { final: inputs.text } }),
      },
      ctxCatalog,
    );

    expect(result.status).toBe("success");
    expect(result.nodeRuns.at(-1)?.outputs.final).toBe("hi");
  });

  it("passes context to every executor", async () => {
    const receivedContexts: unknown[] = [];

    const result = await runWorkflow(
      ctxWorkflow,
      {
        ctxInput: async ({ context }) => {
          receivedContexts.push(context);
          return { outputs: { text: "ok" } };
        },
        ctxOutput: async ({ inputs, context }) => {
          receivedContexts.push(context);
          return { outputs: { final: inputs.text } };
        },
      },
      ctxCatalog,
      { runId: "run-1", values: { rp: { sessionId: "s1", worldId: "w1" } } },
    );

    expect(result.status).toBe("success");
    expect(receivedContexts).toHaveLength(2);
    expect(receivedContexts[0]).toEqual({
      runId: "run-1",
      values: { rp: { sessionId: "s1", worldId: "w1" } },
    });
    expect(receivedContexts[1]).toEqual({
      runId: "run-1",
      values: { rp: { sessionId: "s1", worldId: "w1" } },
    });
  });

  it("isolates context between independent runs", async () => {
    const captured: unknown[] = [];

    const executors = {
      ctxInput: async () => ({ outputs: { text: "ok" } }),
      ctxOutput: async ({ context }: { context?: unknown }) => {
        captured.push(context);
        return { outputs: { final: "done" } };
      },
    };

    await runWorkflow(ctxWorkflow, executors, ctxCatalog, {
      runId: "run-a",
      values: { sessionId: "session-A" },
    });
    await runWorkflow(ctxWorkflow, executors, ctxCatalog, {
      runId: "run-b",
      values: { sessionId: "session-B" },
    });

    expect(captured).toHaveLength(2);
    expect((captured[0] as { values: { sessionId: string } }).values.sessionId).toBe("session-A");
    expect((captured[1] as { values: { sessionId: string } }).values.sessionId).toBe("session-B");
  });
});

describe("Phase I-2.1: Type compatibility regression", () => {
  it("plain json cannot implicitly connect to draft", () => {
    // json without schemaId → draft should be forbidden
    expect(areTypesCompatible("json", "draft")).toBe(false);
  });

  it("json with schemaId cannot connect to draft", () => {
    // json[rp.writer-output.v1] → draft should be forbidden
    expect(areTypesCompatible("json", "draft", "rp.writer-output.v1", undefined)).toBe(false);
    // json[rp.tracker-patch.v1] → draft should be forbidden
    expect(areTypesCompatible("json", "draft", "rp.tracker-patch.v1", undefined)).toBe(false);
  });

  it("draft can connect to draft (same type)", () => {
    // draft → draft is allowed (narrative → textOutput.text)
    expect(areTypesCompatible("draft", "draft")).toBe(true);
  });

  it("draft can connect to text (existing compatibility)", () => {
    // draft → text is allowed (existing rule in compatible set)
    expect(areTypesCompatible("draft", "text")).toBe(true);
    // draft → final_text is also allowed
    expect(areTypesCompatible("draft", "final_text")).toBe(true);
  });

  it("draft can connect to json (existing compatibility)", () => {
    // draft → json is allowed
    expect(areTypesCompatible("draft", "json")).toBe(true);
  });

  it("text can connect to draft (existing compatibility via text:context → json → draft? No)", () => {
    // text → draft is NOT directly allowed
    expect(areTypesCompatible("text", "draft")).toBe(false);
  });
});
