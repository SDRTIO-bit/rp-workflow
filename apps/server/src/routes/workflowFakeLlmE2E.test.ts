/**
 * Server E2E: RP writer with fake adapter.
 * Verifies that when a fake LLM adapter is injected,
 * the retrieval workflow produces LLM-generated narrative (not echo).
 */
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerRpRuntime,
  InMemoryTimelineStore,
  InMemoryChapterStore,
  InMemoryLoreStore,
  InMemoryTrackerStore,
} from "@awp/rp-runtime";
import { nodeRegistry, runWorkflow } from "@awp/workflow-core";
import type { WorkflowDefinition } from "@awp/workflow-core";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const workflowPath = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "data",
  "workflows",
  "rp-retrieval-workflow-v1.json",
);

async function loadWorkflow(): Promise<WorkflowDefinition> {
  const content = await readFile(workflowPath, "utf-8");
  return JSON.parse(content).workflow;
}

function makeFakeLlmAdapter(responseText: string) {
  return {
    provider: "fake-test",
    kind: "llm" as const,
    complete: async (_prompt: string) => ({
      text: responseText,
      tokenUsage: { prompt: 50, completion: 30 },
    }),
  };
}

function makeMockAdapter(responseText: string) {
  return {
    provider: "mock",
    kind: "mock" as const,
    complete: async (_prompt: string) => ({
      text: responseText,
      tokenUsage: { prompt: 0, completion: 0 },
    }),
  };
}

function makeStores() {
  return {
    timeline: new InMemoryTimelineStore(),
    chapter: new InMemoryChapterStore(),
    lore: new InMemoryLoreStore(),
    tracker: new InMemoryTrackerStore(),
  };
}

// Skip: These tests use the old workflow path which is deprecated in B-2.6.1
// The new workflow requires presetResolver, promptCompiler, outputComposer, formatValidator nodes
describe.skip("RP Writer with fake LLM adapter (server E2E)", () => {
  it("produces generationMode=llm with fake adapter", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();
    const fakeAdapter = makeFakeLlmAdapter(
      "The storm raged on as Alice stepped through the tavern door.",
    );

    const rp = registerRpRuntime({
      stores,
      llmAdapter: fakeAdapter,
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "fake-llm-e2e",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun).toBeDefined();
    const wo = writerRun!.outputs.writerOutput as Record<string, unknown>;
    expect(wo.generationMode).toBe("llm");
    expect(wo.text).toBe("The storm raged on as Alice stepped through the tavern door.");

    const narrative = writerRun!.outputs.narrative;
    expect(typeof narrative).toBe("string");
    expect(narrative).toBe("The storm raged on as Alice stepped through the tavern door.");
  });

  it("produces generationMode=mock with mock adapter", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();
    const mockAdapter = makeMockAdapter("[MOCK OUTPUT]");

    const rp = registerRpRuntime({
      stores,
      llmAdapter: mockAdapter,
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "mock-e2e",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    const wo = writerRun!.outputs.writerOutput as Record<string, unknown>;
    expect(wo.generationMode).toBe("mock");
    expect(wo.text).toBe("[MOCK OUTPUT]");
  });

  it("fails in strict mode when no adapter", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();

    const rp = registerRpRuntime({
      stores,
      writerConfig: { strictMode: true, enableEchoFallback: false },
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "strict-test",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("error");
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("error");
    expect(writerRun?.error).toContain("strict mode");
  });

  it("falls back to echo_fallback when no adapter and fallback enabled", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();

    const rp = registerRpRuntime({
      stores,
      // No llmAdapter, fallback enabled by default
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "fallback-test",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    const wo = writerRun!.outputs.writerOutput as Record<string, unknown>;
    expect(wo.generationMode).toBe("echo_fallback");
    const warnings = wo.warnings as string[];
    expect(Array.isArray(warnings)).toBe(true);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("error from adapter propagates (not swallowed) when fallback disabled", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();
    const failingAdapter = {
      provider: "failing",
      kind: "llm" as const,
      complete: async () => {
        throw new Error("API timeout");
      },
    };

    const rp = registerRpRuntime({
      stores,
      llmAdapter: failingAdapter,
      writerConfig: { enableEchoFallback: false },
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "error-test",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("error");
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    expect(writerRun?.status).toBe("error");
    expect(writerRun?.error).toContain("API timeout");
  });

  it("fake adapter receives assembled context (not just userInput)", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();

    // Seed timeline data so context assembly produces timeline content
    await stores.timeline.putEvent({
      sessionId: "test",
      worldId: "test",
      event: {
        eventId: "evt-1",
        sessionId: "test",
        worldId: "test",
        chapterId: "ch1",
        sourceTurnId: "turn-0",
        summary: "Alice entered the Old Harbor Tavern seeking shelter from the storm.",
        characters: ["Alice"],
        locations: ["Old Harbor Tavern"],
        items: ["Sword"],
        time: null,
        emotionalChanges: [],
        createdAt: new Date().toISOString(),
      },
    });

    await stores.lore.putEntry({
      sessionId: "test",
      worldId: "test",
      entry: {
        id: "lore-alice",
        sessionId: "test",
        worldId: "test",
        title: "Alice the Swordswoman",
        content:
          "Alice is a seasoned swordswoman from the northern highlands, carrying a silver-etched blade.",
        keywords: ["Alice", "swordswoman", "northern highlands"],
        category: "character",
        priority: 10,
        activationMode: "always_on",
      },
    });

    await stores.chapter.putChapter({
      sessionId: "test",
      worldId: "test",
      chapter: {
        chapterId: "ch1",
        sessionId: "test",
        worldId: "test",
        title: "Chapter 1",
        summary: "Alice arrives at the Old Harbor Tavern.",
        events: ["evt-1"],
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    let capturedPrompt = "";

    const capturingAdapter = {
      provider: "capturing",
      kind: "llm" as const,
      complete: async (prompt: string) => {
        capturedPrompt = prompt;
        return { text: "Captured.", tokenUsage: { prompt: 0, completion: 0 } };
      },
    };

    const rp = registerRpRuntime({
      stores,
      llmAdapter: capturingAdapter,
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "capture-test",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    await runWorkflow(workflow, executors, catalog, context);

    // Captured prompt should contain assembled context sections
    expect(capturedPrompt).toContain("[User Input]");
    expect(capturedPrompt).toContain("Alice walks into");
    // Should include system prompt area
    expect(capturedPrompt).toContain("creative writing");
    // Should include timeline section from seeded data
    expect(capturedPrompt).toContain("Old Harbor Tavern");
    // Should include lore section from seeded data
    expect(capturedPrompt).toContain("Alice the Swordswoman");
  });

  it("mock adapter triggers no real network request", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();
    const mockAdapter = makeMockAdapter("[MOCK: NO NETWORK]");

    const rp = registerRpRuntime({
      stores,
      llmAdapter: mockAdapter,
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "mock-no-network",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    expect(result.status).toBe("success");

    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    const wo = writerRun!.outputs.writerOutput as Record<string, unknown>;
    expect(wo.generationMode).toBe("mock");
    // Mock adapter returns fixed text, not echo of userInput
    expect(wo.text).toBe("[MOCK: NO NETWORK]");
  });

  it("usage maps correctly through fake adapter", async () => {
    const workflow = await loadWorkflow();
    const stores = makeStores();
    const fakeAdapter = makeFakeLlmAdapter("Generated.");

    const rp = registerRpRuntime({
      stores,
      llmAdapter: fakeAdapter,
    });

    const catalog = { ...nodeRegistry, ...rp.catalog };
    const executors = {
      userInput: async ({ node }: { node: { config: Record<string, unknown> } }) => ({
        outputs: { text: node.config.text ?? "" },
      }),
      textOutput: async ({ inputs }: { inputs: Record<string, unknown> }) => ({
        outputs: { final: inputs.text ?? "" },
      }),
      ...rp.executors,
    };

    const context = {
      runId: "usage-test",
      values: { rp: { sessionId: "test", worldId: "test", turnId: "t1" } },
    };

    const result = await runWorkflow(workflow, executors, catalog, context);
    const writerRun = result.nodeRuns.find((r) => r.nodeId === "writer");
    const wo = writerRun!.outputs.writerOutput as Record<string, unknown>;
    const metadata = wo.metadata as Record<string, unknown>;
    const tokenUsage = metadata.tokenUsage as Record<string, unknown>;

    expect(typeof tokenUsage.input).toBe("number");
    expect(tokenUsage.input).toBeGreaterThan(0);
    expect(typeof tokenUsage.output).toBe("number");
    expect(tokenUsage.output).toBeGreaterThan(0);
    expect(typeof metadata.latencyMs).toBe("number");
  });
});
