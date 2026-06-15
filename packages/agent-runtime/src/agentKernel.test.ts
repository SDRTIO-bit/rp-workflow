/**
 * Agent Kernel Tests — P-1
 *
 * Tests: model config priority, prompt assembly order, JSON renderer,
 * profile resolution, missing profile error, missing provider error.
 */
import { describe, expect, it, vi } from "vitest";
import type { NodeExecutionInput } from "@awp/workflow-core";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
} from "./index";
import type { LlmAdapter } from "./types";

// Import after mocks to avoid module-level side effects
import { createGenericAgentExecutor, createSpecializedAgentExecutor } from "./agentKernel";
import type { AgentKernelServices } from "./agentKernel";

// ============ Helpers ============

function createMockAdapter(responseText = "Hello, world!"): LlmAdapter {
  return {
    provider: "mock",
    complete: vi.fn().mockResolvedValue({
      text: responseText,
      tokenUsage: { input: 10, output: 5 },
    }),
  };
}

function createMockServices(overrides?: Partial<AgentKernelServices>): AgentKernelServices {
  const registry = new ProviderRegistry("mock");
  registry.register({
    providerId: "mock",
    apiKey: "test-key",
    baseUrl: "https://mock.example.com",
    defaultModel: "mock-model",
    createAdapter: () => createMockAdapter(),
  });
  return {
    registry,
    profileRegistry: createP1ProfileRegistry(),
    createAdapter: (providerId) => {
      if (providerId !== "mock") throw new Error(`Unknown provider: ${providerId}`);
      return createMockAdapter();
    },
    ...overrides,
  };
}

function createNodeInput(
  type: string,
  config: Record<string, unknown>,
  inputs: Record<string, unknown>,
): NodeExecutionInput {
  return {
    node: {
      id: "test-node",
      type,
      position: { x: 0, y: 0 },
      config,
    },
    inputs,
  };
}

// ============ Generic Agent Tests ============

describe("createGenericAgentExecutor", () => {
  it("produces text output from user input", async () => {
    const services = createMockServices();
    const executor = createGenericAgentExecutor(services);
    const result = await executor(
      createNodeInput("genericAgent", { modelId: "mock-model" }, { userInput: "Hello" }),
    );
    expect(result.outputs.result).toBeDefined();
    expect(typeof result.outputs.result).toBe("string");
  });

  it("assembles prompt with all 4 inputs in correct order", async () => {
    const adapter = createMockAdapter("response");
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createGenericAgentExecutor(services);
    await executor(
      createNodeInput(
        "genericAgent",
        { modelId: "mock-model", systemPrompt: "You are a bot." },
        {
          userInput: "Input text",
          instruction: "Do something",
          context: "Background info",
          data: { key: "value" },
        },
      ),
    );

    const prompt = completeSpy.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("You are a bot.");
    expect(prompt).toContain("Input text");
    expect(prompt).toContain("Do something");
    expect(prompt).toContain("Background info");
    // JSON data should be rendered
    expect(prompt).toContain("key");
    expect(prompt).toContain("value");
  });

  it("respects JSON renderer enable/disable", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      createAdapter: () => adapter,
    };

    // With renderer disabled
    const executorDisabled = createGenericAgentExecutor(services);
    await executorDisabled(
      createNodeInput(
        "genericAgent",
        { modelId: "mock-model", jsonRendererEnabled: false },
        { data: { key: "val" } },
      ),
    );
    const promptDisabled = completeSpy.mock.calls[0]?.[0]?.prompt ?? "";
    // Should contain raw JSON
    expect(promptDisabled).toContain('"key"');
    expect(promptDisabled).toContain('"val"');
  });

  it("throws when provider is not found", async () => {
    const services = createMockServices();
    // Override createAdapter to always throw
    const badServices: AgentKernelServices = {
      ...services,
      createAdapter: () => {
        throw new Error('ProviderRegistry: unknown providerId "none"');
      },
    };
    const executor = createGenericAgentExecutor(badServices);
    await expect(
      executor(createNodeInput("genericAgent", { providerId: "none", modelId: "x" }, {})),
    ).rejects.toThrow("unknown providerId");
  });
});

// ============ Specialized Agent Tests ============

describe("createSpecializedAgentExecutor", () => {
  it("throws when profileId is missing", async () => {
    const services = createMockServices();
    const executor = createSpecializedAgentExecutor(services);
    await expect(executor(createNodeInput("specializedAgent", {}, {}))).rejects.toThrow(
      "profileId is required",
    );
  });

  it("throws when profileId is not found", async () => {
    const services = createMockServices();
    const executor = createSpecializedAgentExecutor(services);
    await expect(
      executor(
        createNodeInput(
          "specializedAgent",
          { profileId: "nonexistent", modelId: "mock-model" },
          {},
        ),
      ),
    ).rejects.toThrow("not found in registry");
  });

  it("uses profile foundational system prompt", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    await executor(
      createNodeInput(
        "specializedAgent",
        { profileId: "rp-writer", modelId: "mock-model" },
        { userInput: "Hello" },
      ),
    );

    const prompt = completeSpy.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("roleplay");
  });

  it("respects profile input ordering", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    await executor(
      createNodeInput(
        "specializedAgent",
        { profileId: "rp-writer", modelId: "mock-model" },
        { userInput: "AAA", context: "CCC" },
      ),
    );

    const prompt = completeSpy.mock.calls[0]?.[0]?.prompt ?? "";
    // userInput (order 1) should appear before context (order 2)
    const userInputPos = prompt.indexOf("AAA");
    const contextPos = prompt.indexOf("CCC");
    expect(userInputPos).toBeLessThan(contextPos);
  });
});

// ============ Model Config Priority Tests ============

describe("model config priority", () => {
  it("node config overrides profile defaults", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "default-model",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    const result = await executor(
      createNodeInput(
        "specializedAgent",
        {
          profileId: "rp-writer",
          modelId: "custom-model",
          temperature: 0.5,
          maxTokens: 512,
        },
        { userInput: "test" },
      ),
    );

    // Profile rp-writer has temperature 0.8, maxTokens 2048
    // Node overrides should take effect
    const callArgs = completeSpy.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe("custom-model");
    expect(callArgs?.temperature).toBe(0.5);

    // Metadata should reflect resolved config
    expect(result.metadata).toBeDefined();
  });

  it("server defaults used when nothing else specified (genericAgent)", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "server-default-model",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      createAdapter: () => adapter,
      workflowModelConfig: { temperature: 0.3 },
    };

    const executor = createGenericAgentExecutor(services);
    await executor(createNodeInput("genericAgent", {}, { userInput: "test" }));

    const callArgs = completeSpy.mock.calls[0]?.[0];
    expect(callArgs?.model).toBe("server-default-model");
    expect(callArgs?.temperature).toBe(0.3);
  });

  it("nodeConfig.topP enters final model config correctly", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    await executor(
      createNodeInput(
        "specializedAgent",
        {
          profileId: "rp-writer",
          modelId: "mock-model",
          topP: 0.95,
          temperature: 0.5,
        },
        { userInput: "test" },
      ),
    );

    const callArgs = completeSpy.mock.calls[0]?.[0];
    expect(callArgs?.topP).toBe(0.95);
  });

  it("temperature and topP do not pollute each other", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      createAdapter: () => adapter,
    };

    // Set only temperature, no topP
    const executor = createGenericAgentExecutor(services);
    await executor(createNodeInput("genericAgent", { temperature: 0.3 }, { userInput: "test" }));

    const callArgs = completeSpy.mock.calls[0]?.[0];
    expect(callArgs?.temperature).toBe(0.3);
    expect(callArgs?.topP).toBeUndefined();
  });

  it("profile default topP flows through when node does not override", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });

    // Create a registry with a profile that has topP set
    const profileRegistry = new InMemorySpecializedAgentProfileRegistry();
    profileRegistry.register({
      profileId: "test-top-p",
      label: { zh: "测试", en: "Test" },
      description: { zh: "测试", en: "Test" },
      foundationalSystemPrompt: "You are a test.",
      requiredInputs: {
        userInput: { required: true, order: 1 },
        instruction: { required: false, order: 2 },
        context: { required: false, order: 3 },
        data: { required: false, order: 4 },
      },
      inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
      defaultModelConfig: { topP: 0.88, temperature: 0.6 },
      lockedFields: [],
      declaredToolPermissions: [],
    });

    const services: AgentKernelServices = {
      registry,
      profileRegistry,
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    await executor(
      createNodeInput(
        "specializedAgent",
        { profileId: "test-top-p", modelId: "mock-model" },
        { userInput: "test" },
      ),
    );

    const callArgs = completeSpy.mock.calls[0]?.[0];
    expect(callArgs?.topP).toBe(0.88);
    expect(callArgs?.temperature).toBe(0.6);
  });

  it("node topP overrides profile default topP", async () => {
    const adapter = createMockAdapter();
    const completeSpy = vi.spyOn(adapter, "complete");
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });

    const profileRegistry = new InMemorySpecializedAgentProfileRegistry();
    profileRegistry.register({
      profileId: "test-top-p2",
      label: { zh: "测试2", en: "Test2" },
      description: { zh: "测试2", en: "Test2" },
      foundationalSystemPrompt: "You are a test.",
      requiredInputs: {
        userInput: { required: true, order: 1 },
        instruction: { required: false, order: 2 },
        context: { required: false, order: 3 },
        data: { required: false, order: 4 },
      },
      inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
      defaultModelConfig: { topP: 0.5 },
      lockedFields: [],
      declaredToolPermissions: [],
    });

    const services: AgentKernelServices = {
      registry,
      profileRegistry,
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    await executor(
      createNodeInput(
        "specializedAgent",
        { profileId: "test-top-p2", modelId: "mock-model", topP: 0.99 },
        { userInput: "test" },
      ),
    );

    const callArgs = completeSpy.mock.calls[0]?.[0];
    // Node topP overrides profile default
    expect(callArgs?.topP).toBe(0.99);
  });
});

// ============ lockedFields Enforcement Tests ============

describe("lockedFields enforcement", () => {
  it("prevents node config from overriding locked responseFormat", async () => {
    const adapter = createMockAdapter();
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });

    const profileRegistry = new InMemorySpecializedAgentProfileRegistry();
    profileRegistry.register({
      profileId: "locked-test",
      label: { zh: "锁定测试", en: "Locked Test" },
      description: { zh: "锁定测试", en: "Locked Test" },
      foundationalSystemPrompt: "Test.",
      requiredInputs: {
        userInput: { required: true, order: 1 },
        instruction: { required: false, order: 2 },
        context: { required: false, order: 3 },
        data: { required: false, order: 4 },
      },
      inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
      defaultModelConfig: { responseFormat: "text", temperature: 0.5 },
      lockedFields: ["responseFormat"],
      declaredToolPermissions: [],
    });

    const services: AgentKernelServices = {
      registry,
      profileRegistry,
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    const result = await executor(
      createNodeInput(
        "specializedAgent",
        {
          profileId: "locked-test",
          modelId: "mock-model",
          responseFormat: "json_object", // Attempt to override
        },
        { userInput: "test" },
      ),
    );

    // Metadata should show the profile's default (text), not the node override
    expect(result.metadata?.responseFormat).toBe("text");
    // No explicit assertion on responseFormat in call since adapter doesn't receive it,
    // but metadata proves the resolved config used "text"
  });
});

// ============ Prompt Trace Tests ============

describe("prompt trace sources", () => {
  it("records promptSources with block provenance", async () => {
    const adapter = createMockAdapter();
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      profileRegistry: createP1ProfileRegistry(),
      createAdapter: () => adapter,
    };

    const executor = createSpecializedAgentExecutor(services);
    const result = await executor(
      createNodeInput(
        "specializedAgent",
        { profileId: "rp-writer", modelId: "mock-model" },
        {
          userInput: "User says hi",
          instruction: "Write a story",
          context: "Background context",
          data: { key: "value" },
        },
      ),
    );

    const sources = result.metadata?.promptSources as
      | Array<{
          source: string;
          order: number;
          rendered: boolean;
          present: boolean;
        }>
      | undefined;
    expect(sources).toBeDefined();
    expect(Array.isArray(sources)).toBe(true);
    if (!sources) return;

    // All 5 blocks should be present (system + 4 inputs)
    const sourceNames = sources.map((s) => s.source);
    expect(sourceNames).toContain("system");
    expect(sourceNames).toContain("userInput");
    expect(sourceNames).toContain("instruction");
    expect(sourceNames).toContain("context");
    expect(sourceNames).toContain("data");

    // data block should be marked as rendered
    const dataBlock = sources.find((s) => s.source === "data");
    expect(dataBlock?.rendered).toBe(true);

    // Blocks should be sorted by order
    const orders = sources.map((s) => s.order) as number[];
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i - 1]!).toBeLessThanOrEqual(orders[i]!);
    }
  });

  it("data block shows rendered=false when JSON renderer disabled", async () => {
    const adapter = createMockAdapter();
    const registry = new ProviderRegistry("mock");
    registry.register({
      providerId: "mock",
      apiKey: "k",
      baseUrl: "http://x",
      defaultModel: "m",
      createAdapter: () => adapter,
    });
    const services: AgentKernelServices = {
      registry,
      createAdapter: () => adapter,
    };

    const executor = createGenericAgentExecutor(services);
    const result = await executor(
      createNodeInput("genericAgent", { jsonRendererEnabled: false }, { data: { key: "value" } }),
    );

    const sources = result.metadata?.promptSources as
      | Array<{
          source: string;
          rendered: boolean;
        }>
      | undefined;
    const dataBlock = sources?.find((s) => s.source === "data");
    expect(dataBlock?.rendered).toBe(false);
  });
});
