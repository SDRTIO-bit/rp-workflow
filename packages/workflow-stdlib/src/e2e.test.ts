/**
 * Composable Context E2E Test — P-2
 * Self-contained in workflow-stdlib using workflow-core's runner.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runWorkflow,
  validateWorkflow,
  type NodeExecutor,
  type WorkflowDefinition,
  type NodeCatalog,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "./index";

function buildCatalog(): NodeCatalog {
  return {
    playerInput: {
      type: "playerInput",
      label: "Player Input",
      ports: [{ id: "text", label: "Text", direction: "output", wireType: "text" }],
    },
    playerOutput: {
      type: "playerOutput",
      label: "Player Output",
      ports: [
        { id: "text", label: "Text", direction: "input", wireType: "text", required: true },
        { id: "final", label: "Final", direction: "output", wireType: "text" },
      ],
    },
    genericAgent: {
      type: "genericAgent",
      label: "Generic Agent",
      ports: [
        {
          id: "userInput",
          label: "User Input",
          direction: "input",
          wireType: "text",
          required: false,
        },
        {
          id: "instruction",
          label: "Instruction",
          direction: "input",
          wireType: "markdown",
          required: false,
        },
        {
          id: "context",
          label: "Context",
          direction: "input",
          wireType: "markdown",
          required: false,
        },
        { id: "data", label: "Data", direction: "input", wireType: "json", required: false },
        { id: "result", label: "Result", direction: "output", wireType: "text" },
      ],
    },
    inspectOutput: {
      type: "inspectOutput",
      label: "Inspect Output",
      ports: [
        {
          id: "jsonInput",
          label: "JSON Input",
          direction: "input",
          wireType: "json",
          required: false,
        },
        {
          id: "markdownInput",
          label: "Markdown Input",
          direction: "input",
          wireType: "markdown",
          required: false,
        },
        {
          id: "textInput",
          label: "Text Input",
          direction: "input",
          wireType: "text",
          required: false,
        },
      ],
    },
    jsonSource: {
      type: "jsonSource",
      label: "JSON Source",
      ports: [{ id: "json", label: "JSON", direction: "output", wireType: "json" }],
    },
    markdownSource: {
      type: "markdownSource",
      label: "Markdown Source",
      ports: [{ id: "markdown", label: "Markdown", direction: "output", wireType: "markdown" }],
    },
    ...stdlibNodes,
  };
}

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

function createMockAgentExecutor(): NodeExecutor {
  return async ({ inputs }) => {
    const ctxLen = String(inputs.context ?? "").length;
    const instrLen = String(inputs.instruction ?? "").length;
    return {
      outputs: {
        result: `[MOCK AGENT] context=${ctxLen} chars, instruction=${instrLen} chars`,
      },
      metadata: { mock: true },
    };
  };
}

describe("Composable Context E2E", () => {
  const catalog = buildCatalog();

  const executors: Record<string, NodeExecutor> = {
    playerInput: async ({ node }) => ({ outputs: { text: String(node.config.text ?? "") } }),
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    genericAgent: createMockAgentExecutor(),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
    ...createStdlibExecutors(),
  };

  it("loads composable context smoke workflow from disk and runs successfully", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const issues = validateWorkflow(wf, catalog);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    const result = await runWorkflow(wf, executors, catalog);
    expect(result.status).toBe("success");
  });

  it("JSON merge concats worldbook entries", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const result = await runWorkflow(wf, executors, catalog);
    const mergeRun = result.nodeRuns.find((r) => r.nodeId === "merge")!;
    expect(mergeRun.status).toBe("success");
    const merged = mergeRun.outputs.result as Array<{ id: string }>;
    expect(Array.isArray(merged)).toBe(true);
    expect(merged.length).toBe(4);
  });

  it("JSON to Markdown converts merged worldbook", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const result = await runWorkflow(wf, executors, catalog);
    const j2mRun = result.nodeRuns.find((r) => r.nodeId === "j2m")!;
    expect(j2mRun.status).toBe("success");
    const output = String(j2mRun.outputs.output);
    expect(output).toContain("白塔教会");
    expect(output).toContain("圣银骑士团");
    expect(output).toContain("银铃");
    expect(output).toContain("黑潮");
  });

  it("Markdown merge combines style and format", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const result = await runWorkflow(wf, executors, catalog);
    const mdMerge = result.nodeRuns.find((r) => r.nodeId === "mdMerge")!;
    expect(mdMerge.status).toBe("success");
    const output = String(mdMerge.outputs.result);
    expect(output).toContain("写作风格");
    expect(output).toContain("输出格式");
  });

  it("Agent receives merged context and instruction", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const result = await runWorkflow(wf, executors, catalog);
    const agentRun = result.nodeRuns.find((r) => r.nodeId === "agent")!;
    expect(agentRun.status).toBe("success");
    const contextInput = String(agentRun.inputs.context ?? "");
    expect(contextInput).toContain("白塔教会");
    const instrInput = String(agentRun.inputs.instruction ?? "");
    expect(instrInput).toContain("写作风格");
    expect(instrInput).toContain("输出格式");
  });

  it("inspect output receives all three wire types", async () => {
    const wf = loadWorkflowJson("composable-context-smoke-v1.json");
    const result = await runWorkflow(wf, executors, catalog);
    const insp = result.nodeRuns.find((r) => r.nodeId === "inspector")!;
    expect(insp.status).toBe("success");
    const dbg = String(insp.outputs.debug ?? "");
    expect(dbg).toContain("[JSON]");
    expect(dbg).toContain("[Markdown]");
    expect(dbg).toContain("[Text]");
  });
});
