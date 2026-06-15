/**
 * Three-Wire Static Agent Smoke E2E Test — P-1
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runWorkflow,
  validateWorkflow,
  nodeRegistry,
  type NodeExecutor,
  type WorkflowDefinition,
} from "@awp/workflow-core";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createGenericAgentExecutor,
  createSpecializedAgentExecutor,
} from "./index";

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

function createMockAdapter(text = "[MOCK]") {
  return {
    provider: "mock",
    complete: async (i: { model: string; prompt: string; temperature?: number }) => ({
      text,
      tokenUsage: { input: Math.ceil(i.prompt.length / 4), output: Math.ceil(text.length / 4) },
    }),
  };
}

function createServices() {
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => createMockAdapter(),
  });
  return { registry: r, profileRegistry: createP1ProfileRegistry() };
}

function createExecutors(
  registry: ProviderRegistry,
  pr: InMemorySpecializedAgentProfileRegistry,
): Record<string, NodeExecutor> {
  const a = () => createMockAdapter();
  return {
    playerInput: async ({ node }) => ({ outputs: { text: String(node.config.text ?? "") } }),
    markdownSource: async ({ node }) => ({
      outputs: { markdown: String(node.config.content ?? "") },
    }),
    jsonSource: async ({ node }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    genericAgent: createGenericAgentExecutor({ registry, profileRegistry: pr, createAdapter: a }),
    specializedAgent: createSpecializedAgentExecutor({
      registry,
      profileRegistry: pr,
      createAdapter: a,
    }),
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
  };
}

describe("Three-Wire Static Agent E2E", () => {
  const { registry, profileRegistry } = createServices();
  const execs = createExecutors(registry, profileRegistry);

  it("loads smoke workflow from disk and runs successfully", async () => {
    const wf = loadWorkflowJson("three-wire-static-agent-smoke-v1.json");
    const issues = validateWorkflow(wf, nodeRegistry);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    const result = await runWorkflow(wf, execs, nodeRegistry);
    expect(result.status).toBe("success");
  });

  it("inspect output receives all three wire types", async () => {
    const wf = loadWorkflowJson("three-wire-static-agent-smoke-v1.json");
    const result = await runWorkflow(wf, execs, nodeRegistry);
    const insp = result.nodeRuns.find((r) => r.nodeId === "inspector")!;
    expect(insp.status).toBe("success");
    const dbg = String(insp.outputs.debug ?? "");
    expect(dbg).toContain("[JSON]");
    expect(dbg).toContain("[Markdown]");
    expect(dbg).toContain("[Text]");
  });

  it("rejects cross-wire connections", () => {
    const wf = loadWorkflowJson("three-wire-static-agent-smoke-v1.json");
    const bad: WorkflowDefinition = {
      ...wf,
      edges: wf.edges.map((e) => (e.id === "e_input" ? { ...e, targetPort: "data" } : e)),
    };
    const issues = validateWorkflow(bad, nodeRegistry);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Incompatible"))).toBe(
      true,
    );
  });

  it("specializedAgent with rp-writer profile runs", async () => {
    const wf: WorkflowDefinition = {
      id: "s",
      name: "S",
      version: 1,
      nodes: [
        { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
        {
          id: "ag",
          type: "specializedAgent",
          position: { x: 200, y: 0 },
          config: { profileId: "rp-writer", modelId: "mock-model" },
        },
        { id: "out", type: "playerOutput", position: { x: 400, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "in", sourcePort: "text", target: "ag", targetPort: "userInput" },
        { id: "e2", source: "ag", sourcePort: "result", target: "out", targetPort: "text" },
      ],
    };
    const result = await runWorkflow(wf, execs, nodeRegistry);
    expect(result.status).toBe("success");
    expect(result.nodeRuns.find((r) => r.nodeId === "ag")!.metadata!.profileId).toBe("rp-writer");
  });

  it("missing profile errors clearly", async () => {
    const wf: WorkflowDefinition = {
      id: "m",
      name: "M",
      version: 1,
      nodes: [
        { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "x" } },
        {
          id: "ag",
          type: "specializedAgent",
          position: { x: 200, y: 0 },
          config: { profileId: "no", modelId: "mock-model" },
        },
        { id: "out", type: "playerOutput", position: { x: 400, y: 0 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "in", sourcePort: "text", target: "ag", targetPort: "userInput" },
        { id: "e2", source: "ag", sourcePort: "result", target: "out", targetPort: "text" },
      ],
    };
    const result = await runWorkflow(wf, execs, nodeRegistry);
    const r = result.nodeRuns.find((r) => r.nodeId === "ag")!;
    expect(r.status).toBe("error");
    expect(r.error).toContain("not found in registry");
  });

  it("playerOutput rejects json → text connection", () => {
    const wf: WorkflowDefinition = {
      id: "b",
      name: "B",
      version: 1,
      nodes: [
        { id: "js", type: "jsonSource", position: { x: 0, y: 0 }, config: { data: "{}" } },
        { id: "out", type: "playerOutput", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "js", sourcePort: "json", target: "out", targetPort: "text" }],
    };
    const issues = validateWorkflow(wf, nodeRegistry);
    expect(issues.some((i) => i.level === "error" && i.message.includes("Incompatible"))).toBe(
      true,
    );
  });

  it("inspectOutput accepts three independent ports", async () => {
    const wf: WorkflowDefinition = {
      id: "i",
      name: "I",
      version: 1,
      nodes: [
        { id: "js", type: "jsonSource", position: { x: 0, y: 0 }, config: { data: '{"k":"v"}' } },
        {
          id: "md",
          type: "markdownSource",
          position: { x: 0, y: 100 },
          config: { content: "# H" },
        },
        { id: "pi", type: "playerInput", position: { x: 0, y: 200 }, config: { text: "t" } },
        { id: "insp", type: "inspectOutput", position: { x: 300, y: 100 }, config: {} },
      ],
      edges: [
        { id: "e1", source: "js", sourcePort: "json", target: "insp", targetPort: "jsonInput" },
        {
          id: "e2",
          source: "md",
          sourcePort: "markdown",
          target: "insp",
          targetPort: "markdownInput",
        },
        { id: "e3", source: "pi", sourcePort: "text", target: "insp", targetPort: "textInput" },
      ],
    };
    const result = await runWorkflow(wf, execs, nodeRegistry);
    expect(result.status).toBe("success");
    const dbg = String(result.nodeRuns.find((r) => r.nodeId === "insp")!.outputs.debug ?? "");
    expect(dbg).toContain("[JSON]");
    expect(dbg).toContain("[Markdown]");
    expect(dbg).toContain("[Text]");
  });
});
