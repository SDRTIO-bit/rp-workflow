import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProviderRegistry, LlmRouter } from "@awp/agent-runtime";

// Mock modules that createExecutors depends on
vi.mock("@awp/agent-runtime", async () => {
  const actual = await vi.importActual("@awp/agent-runtime");
  return {
    ...(actual as object),
    executeAgentNode: vi.fn(),
  };
});

vi.mock("../services/jsonStore.js", () => ({
  readEntries: vi.fn().mockResolvedValue([]),
}));

import { executeAgentNode } from "@awp/agent-runtime";
import { createExecutors } from "../services/workflowRunner.js";
import type { WorkflowDefinition } from "@awp/workflow-core";

const mockExecuteAgentNode = vi.mocked(executeAgentNode);

function createMockRouter(defaultModel = "deepseek-v4-flash"): LlmRouter {
  const registry = new ProviderRegistry("mock");
  registry.register({
    providerId: "mock",
    apiKey: "test-key",
    baseUrl: "https://mock.example.com",
    defaultModel,
    createAdapter: () => ({
      provider: "mock",
      complete: async () => ({ text: "mock", tokenUsage: { input: 0, output: 0 } }),
    }),
  });
  return new LlmRouter(registry);
}

const mockWorkflow: WorkflowDefinition = {
  id: "test-mock-model",
  name: "Test Mock Model",
  version: 1,
  nodes: [{ id: "a1", type: "agent", position: { x: 0, y: 0 }, config: { model: "mock-pro" } }],
  edges: [],
};

const baseContext = {
  llmRouter: createMockRouter(),
  memoryFile: "/nonexistent",
  worldbookFile: "/nonexistent",
  plugins: [],
  skillCatalog: [],
  pluginCatalog: {},
  rpRuntime: null,
};

describe("createExecutors mock model selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteAgentNode.mockResolvedValue({
      text: "mock output",
      metadata: {
        nodeId: "a1",
        model: "mock-pro",
        provider: "deepseek",
        cacheablePrefixHash: "abc",
        dynamicInputHash: "def",
        visibleSkillIds: [],
        visiblePluginIds: [],
        tokenUsage: { input: 0, output: 0 },
        latencyMs: 0,
      },
    });
  });

  it("uses mock model when node config sets mock-pro", async () => {
    const executors = await createExecutors(mockWorkflow, baseContext);
    const agentExecutor = executors["agent"];

    await agentExecutor!({
      node: mockWorkflow.nodes[0]!,
      inputs: {},
    });

    const callArgs = mockExecuteAgentNode.mock.calls[0]![0];
    expect(callArgs.config.model).toBe("mock-pro");
  });

  it("uses real model when node config sets a real model", async () => {
    const wf: WorkflowDefinition = {
      ...mockWorkflow,
      nodes: [
        { id: "a1", type: "agent", position: { x: 0, y: 0 }, config: { model: "deepseek-v4-pro" } },
      ],
    };

    const executors = await createExecutors(wf, baseContext);
    const agentExecutor = executors["agent"];

    await agentExecutor!({
      node: wf.nodes[0]!,
      inputs: {},
    });

    const callArgs = mockExecuteAgentNode.mock.calls[0]![0];
    expect(callArgs.config.model).toBe("deepseek-v4-pro");
  });

  it("falls back to default model when node has no model config", async () => {
    const wf: WorkflowDefinition = {
      ...mockWorkflow,
      nodes: [{ id: "a1", type: "agent", position: { x: 0, y: 0 }, config: {} }],
    };

    const executors = await createExecutors(wf, baseContext);
    const agentExecutor = executors["agent"];

    await agentExecutor!({
      node: wf.nodes[0]!,
      inputs: {},
    });

    const callArgs = mockExecuteAgentNode.mock.calls[0]![0];
    // Model falls back to the router's resolved default
    expect(callArgs.config.model).toBeDefined();
    expect(typeof callArgs.config.model).toBe("string");
  });

  it("never passes default model when a mock model is explicitly selected", async () => {
    const contexts = [
      { ...baseContext, llmRouter: createMockRouter("deepseek-v4-pro") },
      { ...baseContext, llmRouter: createMockRouter("deepseek-reasoner") },
    ];

    for (const ctx of contexts) {
      vi.clearAllMocks();
      mockExecuteAgentNode.mockResolvedValue({
        text: "ok",
        metadata: {
          nodeId: "a1",
          model: "mock-pro",
          provider: "deepseek",
          cacheablePrefixHash: "x",
          dynamicInputHash: "y",
          visibleSkillIds: [],
          visiblePluginIds: [],
          tokenUsage: { input: 0, output: 0 },
          latencyMs: 0,
        },
      });

      const executors = await createExecutors(mockWorkflow, ctx);
      await executors["agent"]!({
        node: mockWorkflow.nodes[0]!,
        inputs: {},
      });

      const callArgs = mockExecuteAgentNode.mock.calls[0]![0];
      expect(callArgs.config.model).toBe("mock-pro");
    }
  });
});
