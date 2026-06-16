/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import { OfficialRpService } from "./officialRpService.js";
import type { OfficialRpRequestV1, OfficialRpServiceContext } from "./officialRpTypes.js";
import {
  ProviderRegistry,
  LlmRouter,
  createP1ProfileRegistry,
  InMemoryAgentSessionStore,
  rpMemoryCommitPolicyNode,
  rpCriticQualityGateNode,
  rpSideEffectDecisionNode,
  failWorkflowNode,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  type LlmAdapter,
} from "@awp/agent-runtime";
import { nodeRegistry } from "@awp/workflow-core";
import { stdlibNodes } from "@awp/workflow-stdlib";
import { dynamicWorldbookNode, InMemoryDynamicWorldbookStore } from "@awp/workflow-worldbook";
import { genericRetrieverNode, retrievalResultToMarkdownNode } from "@awp/workflow-retrieval";
import {
  memoryCorpusNode,
  memoryWriteNode,
  InMemoryWorkflowMemoryStore,
} from "@awp/workflow-memory";

const W1 = "银铃接过钥匙。";
const W2 = "银铃没有立刻拿走钥匙，只是等他说完。";
const ACCEPT = JSON.stringify({
  decision: "accept",
  scores: {
    continuity: 0.9,
    characterConsistency: 0.9,
    playerAgency: 0.95,
    knowledgeBoundary: 0.9,
    styleAndFormat: 0.9,
  },
  issues: [],
});
const REVISE = JSON.stringify({
  decision: "revise",
  scores: {
    continuity: 0.8,
    characterConsistency: 0.8,
    playerAgency: 0.2,
    knowledgeBoundary: 0.8,
    styleAndFormat: 0.8,
  },
  issues: [
    {
      code: "player-agency",
      severity: "error",
      message: "controls player",
      suggestion: "Preserve player agency.",
    },
  ],
  revisionInstruction: "Do not decide for the player.",
});
const CURATOR = JSON.stringify([
  {
    kind: "event",
    summary: "Player offered the warehouse key.",
    entityIds: ["player", "yin_ling"],
    importance: 0.8,
    confidence: 0.9,
  },
]);

describe("P-13A Official RP observability", () => {
  it("records first-pass accepted LLM calls without writer2 or critic2 invocations", async () => {
    const service = new OfficialRpService(
      makeContext([text(W1, 10, 5), text(ACCEPT, 6, 4), text(CURATOR, 3, 2)]),
    );

    const response = await service.runTurn(makeRequest());

    expect(response.traceId).toMatch(/^trace_/);
    expect(response.observability?.llmCalls).toBe(3);
    expect(response.observability?.roles).toEqual({ writer: 1, critic: 1, memoryCurator: 1 });
    expect(response.observability?.usage).toEqual({
      inputTokens: 19,
      outputTokens: 11,
      totalTokens: 30,
      unavailableInvocationCount: 0,
    });
  });

  it("records revision-pass accepted attempts deterministically", async () => {
    const ctx = makeContext([
      text(W1, 10, 5),
      text(REVISE, 6, 4),
      text(W2, 8, 6),
      text(ACCEPT, 7, 3),
      text(CURATOR, 2, 1),
    ]);
    const service = new OfficialRpService(ctx);

    const response = await service.runTurn(makeRequest({ turnId: "turn-revision" }));

    expect(response.narrative).toBe(W2);
    expect(response.quality?.writerAttempts).toBe(2);
    expect(response.quality?.criticAttempts).toBe(2);
    expect(response.quality?.revisionApplied).toBe(true);
    expect(response.observability?.llmCalls).toBe(5);
    expect(response.observability?.roles).toEqual({ writer: 2, critic: 2, memoryCurator: 1 });
    const invocations = (ctx.__events ?? []).filter(
      (event): event is Record<string, unknown> =>
        typeof event === "object" && event !== null && "nodeId" in event,
    );
    expect(invocations.map((event) => `${event.role}:${event.attempt}`)).toEqual([
      "writer:1",
      "critic:1",
      "writer:2",
      "critic:2",
      "memory-curator:1",
    ]);
  });

  it("records return-latest without curator invocation", async () => {
    const service = new OfficialRpService(
      makeContext([text(W1, 10, 5), text(REVISE, 6, 4), text(W2, 8, 6), text(REVISE, 7, 3)]),
    );

    const response = await service.runTurn(
      makeRequest({ turnId: "turn-return-latest", behavior: { onExhausted: "return-latest" } }),
    );

    expect(response.quality?.exhausted).toBe(true);
    expect(response.observability?.llmCalls).toBe(4);
    expect(response.observability?.roles.memoryCurator).toBe(0);
  });

  it("counts unavailable usage without fabricating total tokens", async () => {
    const service = new OfficialRpService(
      makeContext([
        { text: W1, tokenUsage: { availability: "unavailable", source: "unavailable" } },
        text(ACCEPT, 6, 4),
        text(CURATOR, 3, 2),
      ]),
    );

    const response = await service.runTurn(makeRequest({ turnId: "turn-unavailable" }));

    expect(response.observability?.usage.unavailableInvocationCount).toBe(1);
    expect(response.observability?.usage.totalTokens).toBe(15);
  });

  it("stops the unified runtime when a request usage budget is exceeded", async () => {
    const ctx = makeContext([text(W1, 10, 5), text(ACCEPT, 6, 4), text(CURATOR, 3, 2)]);
    const service = new OfficialRpService(ctx);

    await expect(
      service.runTurn(
        makeRequest({
          turnId: "turn-budget",
          usageBudget: { maxTotalTokens: 12 },
        }),
      ),
    ).rejects.toThrow("Workflow usage budget exceeded");

    const invocations = (ctx.__events ?? []).filter(
      (event): event is Record<string, unknown> =>
        typeof event === "object" && event !== null && "nodeId" in event,
    );
    const summaries = (ctx.__events ?? []).filter(
      (event): event is Record<string, any> =>
        typeof event === "object" && event !== null && "budget" in event,
    );
    expect(invocations).toHaveLength(1);
    expect(summaries[0]?.budget).toEqual({
      exceeded: true,
      reasons: ["maxTotalTokens exceeded: 15 > 12"],
    });
  });

  it("records failed provider invocation without leaking prompt or secret and preserves original error", async () => {
    const ctx = makeContext([
      {
        error: new Error("provider exploded with sk-test-secret"),
      },
    ]);
    const service = new OfficialRpService(ctx);

    await expect(service.runTurn(makeRequest({ turnId: "turn-fail" }))).rejects.toThrow(
      "provider exploded",
    );

    const event = ctx.__events?.[0] as Record<string, unknown>;
    expect(event.status).toBe("error");
    expect(event.errorCode).toBe("LLM_PROVIDER_ERROR");
    expect(typeof event.latencyMs).toBe("number");
    expect(JSON.stringify(event)).not.toContain("我把仓库钥匙");
    expect(JSON.stringify(event)).not.toContain("sk-test-secret");
  });

  it("logs a safe structured completion summary", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const service = new OfficialRpService(
      makeContext([text(W1, 10, 5), text(ACCEPT, 6, 4), text(CURATOR, 3, 2)]),
    );

    await service.runTurn(makeRequest({ turnId: "turn-log" }));

    const payloads = spy.mock.calls.map((call) => String(call[0]));
    expect(payloads.some((line) => line.includes("official_rp_turn_completed"))).toBe(true);
    expect(payloads.join("\n")).not.toContain("我把仓库钥匙");
    spy.mockRestore();
  });
});

function text(value: string, input: number, output: number) {
  return {
    text: value,
    tokenUsage: {
      availability: "available" as const,
      source: "provider" as const,
      input,
      output,
      total: input + output,
    },
  };
}

function makeAdapter(
  responses: Array<
    | { text: string; tokenUsage: any }
    | {
        error: Error;
      }
  >,
): LlmAdapter {
  let index = 0;
  return {
    provider: "mock",
    async complete() {
      const response = responses[index++];
      if (!response) {
        throw new Error(`LLM call ${index} exceeded configured responses`);
      }
      if ("error" in response) {
        throw response.error;
      }
      return response;
    },
  };
}

function makeContext(
  responses: Array<{ text: string; tokenUsage: any } | { error: Error }>,
): OfficialRpServiceContext & { __events?: unknown[] } {
  const events: unknown[] = [];
  const registry = new ProviderRegistry("mock");
  registry.register({
    providerId: "mock",
    apiKey: "secret-key",
    baseUrl: "http://mock",
    defaultModel: "mock-model",
    createAdapter: () => makeAdapter(responses),
  });

  return {
    __events: events,
    serverWorkflowVersion: "unified-v1",
    llmRouter: new LlmRouter(registry),
    profileRegistry: createP1ProfileRegistry(),
    sessionStore: new InMemoryAgentSessionStore(),
    memoryStore: new InMemoryWorkflowMemoryStore(),
    worldbookStore: new InMemoryDynamicWorldbookStore(),
    runtimeNodeCatalog: {
      ...nodeRegistry,
      ...stdlibNodes,
      dynamicWorldbook: dynamicWorldbookNode,
      genericRetriever: genericRetrieverNode,
      retrievalResultToMarkdown: retrievalResultToMarkdownNode,
      memoryWrite: memoryWriteNode,
      memoryCorpus: memoryCorpusNode,
      rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
      rpCriticQualityGate: rpCriticQualityGateNode,
      rpSideEffectDecision: rpSideEffectDecisionNode,
      failWorkflow: failWorkflowNode,
      agentSessionLoadV1: agentSessionLoadV1Definition,
      agentSessionCommitV1: agentSessionCommitV1Definition,
    },
    dataDir: resolve(__dirname, "..", "..", "..", "..", "data"),
    telemetrySink: {
      async recordLlmInvocation(event) {
        events.push(event);
      },
      async recordRunSummary(summary) {
        events.push(summary);
      },
    },
  } as OfficialRpServiceContext & { __events: unknown[] };
}

function makeRequest(overrides?: Partial<OfficialRpRequestV1>): OfficialRpRequestV1 {
  return {
    sessionId: "session-p13a",
    turnId: "turn-001",
    userInput: "我把仓库钥匙推到银铃面前。",
    worldbook: { resourceRef: "worldbook:default" },
    memory: { namespace: "rp-p13a" },
    ...overrides,
  };
}
