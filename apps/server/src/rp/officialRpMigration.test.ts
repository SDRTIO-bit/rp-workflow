/**
 * P-12: Official RP Workflow Migration E2E Tests
 *
 * Covers: Registry, Configuration, Input/Output Adapters, Service, API E2E, Legacy fallback.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  OfficialWorkflowRegistry,
  type OfficialWorkflowEntry,
} from "./officialWorkflowRegistry.js";
import { adaptRpInput } from "./officialRpInputAdapter.js";
import { adaptRpOutput } from "./officialRpOutputAdapter.js";
import { OfficialRpService } from "./officialRpService.js";
import { createRpExecutors } from "./officialRpExecutorFactory.js";
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
} from "@awp/agent-runtime";
import { nodeRegistry, validateWorkflow } from "@awp/workflow-core";
import { stdlibNodes } from "@awp/workflow-stdlib";
import { dynamicWorldbookNode, InMemoryDynamicWorldbookStore } from "@awp/workflow-worldbook";
import { genericRetrieverNode, retrievalResultToMarkdownNode } from "@awp/workflow-retrieval";
import {
  memoryWriteNode,
  memoryCorpusNode,
  InMemoryWorkflowMemoryStore,
} from "@awp/workflow-memory";

// ── Helpers ──

function makeDataDir(): string {
  // Go up from apps/server/src/rp/ to project root, then data/
  return resolve(__dirname, "..", "..", "..", "..", "data");
}

function makeServiceContext(
  overrides?: Partial<OfficialRpServiceContext>,
): OfficialRpServiceContext {
  const registry = new ProviderRegistry("mock");
  registry.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => ({
      provider: "mock",
      async complete(_p: any) {
        return { text: "Mock reply", tokenUsage: { input: 10, output: 20 } };
      },
    }),
  });

  const defaultCtx: OfficialRpServiceContext = {
    serverWorkflowVersion: "unified-v1",
    llmRouter: new LlmRouter(registry),
    profileRegistry: createP1ProfileRegistry(),
    sessionStore: new InMemoryAgentSessionStore(),
    memoryStore: new InMemoryWorkflowMemoryStore(),
    worldbookStore: new InMemoryDynamicWorldbookStore(),
    runtimeNodeCatalog: {},
    dataDir: makeDataDir(),
  };

  const ctx = { ...defaultCtx, ...overrides };

  // Ensure runtimeNodeCatalog has the necessary nodes for validation
  if (Object.keys(ctx.runtimeNodeCatalog).length === 0) {
    ctx.runtimeNodeCatalog = {
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
    };
  }

  return ctx;
}

function makeRequest(overrides?: Partial<OfficialRpRequestV1>): OfficialRpRequestV1 {
  return {
    sessionId: "session-test-001",
    turnId: "turn-001",
    userInput: "我把仓库钥匙推到银铃面前。",
    worldbook: { resourceRef: "worldbook:default" },
    memory: { namespace: "rp-test:session-test-001" },
    ...overrides,
  };
}

function makeEmptyRunResult(): any {
  return {
    workflowId: "test",
    status: "success",
    batches: [],
    nodeRuns: [],
    validationIssues: [],
  };
}

// ── Registry Tests ──

describe("P-12: OfficialWorkflowRegistry", () => {
  it("1. registers unified workflow", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.get("official-rp-unified-v1");
    expect(entry.id).toBe("official-rp-unified-v1");
    expect(entry.category).toBe("rp");
    expect(entry.status).toBe("stable");
    expect(entry.workflowFile).toContain("rp-unified-stateful-production-v1.json");
  });

  it("2. registers legacy workflow", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.get("official-rp-legacy-v1");
    expect(entry.id).toBe("official-rp-legacy-v1");
    expect(entry.status).toBe("legacy");
  });

  it("3. duplicate ID throws", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    expect(() =>
      registry.register({
        id: "official-rp-unified-v1",
        version: 1,
        category: "rp",
        status: "stable",
        workflowFile: "/x",
        description: "dup",
      }),
    ).toThrow("duplicate");
  });

  it("4. stable default is unique", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const def = registry.getStableRpDefault();
    expect(def.id).toBe("official-rp-unified-v1");
  });

  it("5. unknown ID throws", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    expect(() => registry.get("nonexistent")).toThrow("unknown workflow ID");
  });

  it("6. file not found throws", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry: OfficialWorkflowEntry = {
      id: "test-missing",
      version: 1,
      category: "rp",
      status: "stable",
      workflowFile: "/nonexistent/path.json",
      description: "test",
    };
    registry.register(entry);
    expect(() => registry.loadWorkflow(entry)).toThrow("not found");
  });
});

// ── Input Adapter Tests ──

describe("P-12: Input Adapter", () => {
  let workflow: any;

  beforeEach(() => {
    workflow = JSON.parse(
      readFileSync(
        resolve(makeDataDir(), "workflows", "rp-unified-stateful-production-v1.json"),
        "utf-8",
      ),
    ).workflow;
  });

  it("7. valid request succeeds", () => {
    const result = adaptRpInput(makeRequest(), workflow);
    expect(result.workflow).toBeDefined();
    expect(result.context.sessionId).toBe("session-test-001");
  });

  it("8. missing sessionId throws", () => {
    expect(() => adaptRpInput(makeRequest({ sessionId: "" }), workflow)).toThrow('"sessionId"');
  });

  it("9. missing turnId throws", () => {
    expect(() => adaptRpInput(makeRequest({ turnId: "" }), workflow)).toThrow('"turnId"');
  });

  it("10. empty userInput throws validation error", () => {
    expect(() => adaptRpInput(makeRequest({ userInput: "" }), workflow)).toThrow('"userInput"');
  });

  it("11. continue variants normalized", () => {
    const result = adaptRpInput(makeRequest({ userInput: "继续" }), workflow);
    const inputNode = result.workflow.nodes.find((n: any) => n.id === "input");
    expect(inputNode?.config?.text).toBe("(继续)");
  });

  it("12. namespace injected into memory nodes", () => {
    const result = adaptRpInput(makeRequest({ memory: { namespace: "custom-ns" } }), workflow);
    const memCorpus = result.workflow.nodes.find((n: any) => n.id === "memCorpus");
    expect(memCorpus?.config?.namespace).toBe("custom-ns");
  });

  it("13. worldbook resourceRef injected", () => {
    const result = adaptRpInput(
      makeRequest({ worldbook: { resourceRef: "worldbook:custom" } }),
      workflow,
    );
    const wbNode = result.workflow.nodes.find((n: any) => n.id === "worldbook");
    expect(wbNode?.config?.resourceRef).toBe("worldbook:custom");
  });

  it("14. original workflow not mutated", () => {
    const copy = JSON.parse(JSON.stringify(workflow));
    adaptRpInput(makeRequest(), workflow);
    expect(workflow).toEqual(copy);
  });

  it("15. sessionKey uses request sessionId", () => {
    const result = adaptRpInput(makeRequest({ sessionId: "my-session" }), workflow);
    const skNode = result.workflow.nodes.find((n: any) => n.id === "sessionKey");
    const sk = JSON.parse(String(skNode?.config?.data ?? "{}"));
    expect(sk.conversationId).toBe("my-session");
  });

  it("16. turnId injected", () => {
    const result = adaptRpInput(makeRequest({ turnId: "turn-abc" }), workflow);
    const tidNode = result.workflow.nodes.find((n: any) => n.id === "turnId");
    const tid = JSON.parse(String(tidNode?.config?.data ?? '""'));
    expect(tid).toBe("turn-abc");
  });

  it("17. onExhausted injected into decision node", () => {
    const result = adaptRpInput(makeRequest({ behavior: { onExhausted: "fail" } }), workflow);
    const decNode = result.workflow.nodes.find((n: any) => n.id === "decision");
    expect(decNode?.config?.onExhausted).toBe("fail");
  });

  it("17a. strips fixture mock-model overrides when request has no model", () => {
    const result = adaptRpInput(makeRequest(), workflow);
    const agentNodes = result.workflow.nodes.filter((n: any) => n.type === "specializedAgent");

    expect(agentNodes.length).toBeGreaterThan(0);
    for (const node of agentNodes) {
      expect(node.config?.modelId).toBeUndefined();
      expect(node.config?.providerId).toBeUndefined();
    }
  });

  it("17b. applies explicit provider and model overrides to official agents", () => {
    const result = adaptRpInput(
      makeRequest({
        model: { providerId: "deepseek", model: "deepseek-v4-flash", temperature: 0.4 },
      }),
      workflow,
    );
    const agentNodes = result.workflow.nodes.filter((n: any) => n.type === "specializedAgent");

    expect(agentNodes.length).toBeGreaterThan(0);
    for (const node of agentNodes) {
      expect(node.config?.providerId).toBe("deepseek");
      expect(node.config?.modelId).toBe("deepseek-v4-flash");
      expect(node.config?.temperature).toBe(0.4);
    }
  });
});

// ── Output Adapter Tests ──

describe("P-12: Output Adapter", () => {
  it("18. extracts narrative from output node", () => {
    const result = makeEmptyRunResult();
    result.nodeRuns = [
      {
        nodeId: "output",
        status: "success",
        outputs: { final: "银铃接过钥匙，微微一笑。" },
        startedAt: 0,
        endedAt: 1,
      },
    ];
    const response = adaptRpOutput(
      result,
      "session-a",
      "turn-1",
      "test-wf",
      1,
      "unified-v1",
      "trace-test",
    );
    expect(response.narrative).toBe("银铃接过钥匙，微微一笑。");
  });

  it("19. extracts quality from decision output", () => {
    const result = makeEmptyRunResult();
    result.nodeRuns = [
      { nodeId: "output", status: "success", outputs: { final: "ok" }, startedAt: 0, endedAt: 1 },
      {
        nodeId: "decision",
        status: "success",
        outputs: {
          decision: {
            accepted: true,
            exhausted: false,
            writerAttempts: 1,
            criticAttempts: 1,
            revisionApplied: false,
            allowPlayerOutput: true,
            allowSessionCommit: true,
            allowMemoryCommit: true,
            reason: "accepted",
          },
        },
        startedAt: 0,
        endedAt: 1,
      },
    ];
    const response = adaptRpOutput(result, "s", "t", "w", 1, "unified-v1", "trace-test");
    expect(response.quality?.accepted).toBe(true);
    expect(response.quality?.exhausted).toBe(false);
    expect(response.quality?.writerAttempts).toBe(1);
  });

  it("20. error result does not mask as success", () => {
    const result = makeEmptyRunResult();
    result.status = "error";
    const response = adaptRpOutput(result, "s", "t", "w", 1, "unified-v1", "trace-test");
    expect(response.narrative).toBe("");
  });

  it("21. missing output node returns empty narrative", () => {
    const result = makeEmptyRunResult();
    const response = adaptRpOutput(result, "s", "t", "w", 1, "unified-v1", "trace-test");
    expect(response.narrative).toBe("");
  });

  it("22. traceId is always present", () => {
    const result = makeEmptyRunResult();
    const response = adaptRpOutput(result, "s", "t", "w", 1, "unified-v1", "trace-test");
    expect(response.traceId).toBeDefined();
    expect(typeof response.traceId).toBe("string");
    expect(response.traceId.length).toBeGreaterThan(0);
  });
});

// ── Service Tests ──

describe("P-12: OfficialRpService", () => {
  it("23. service created with context", () => {
    const ctx = makeServiceContext();
    const service = new OfficialRpService(ctx);
    expect(service).toBeDefined();
  });

  it("24. registry accessible", () => {
    const ctx = makeServiceContext();
    const service = new OfficialRpService(ctx);
    const registry = service.getRegistry();
    expect(registry.getStableRpDefault()).toBeDefined();
  });

  it("25. invalid workflowVersion throws", async () => {
    const ctx = makeServiceContext();
    const service = new OfficialRpService(ctx);
    await expect(
      service.runTurn(makeRequest({ workflowVersion: "invalid" as any })),
    ).rejects.toThrow("Unsupported");
  });

  it("26. invalid onExhausted is caught by input adapter", () => {
    const workflow = JSON.parse(
      readFileSync(
        resolve(makeDataDir(), "workflows", "rp-unified-stateful-production-v1.json"),
        "utf-8",
      ),
    ).workflow;
    expect(() =>
      adaptRpInput(makeRequest({ behavior: { onExhausted: "bad" as any } }), workflow),
    ).toThrow("onExhausted");
  });
});

// ── Configuration Tests ──

describe("P-12: Configuration", () => {
  it("27. default rpWorkflowVersion is unified-v1", () => {
    const ctx = makeServiceContext();
    expect(ctx.serverWorkflowVersion).toBe("unified-v1");
  });

  it("28. legacy config works", () => {
    const ctx = makeServiceContext({ serverWorkflowVersion: "legacy" });
    expect(ctx.serverWorkflowVersion).toBe("legacy");
  });

  it("29. service respects server config default", () => {
    const ctx = makeServiceContext({ serverWorkflowVersion: "unified-v1" });
    const service = new OfficialRpService(ctx);
    expect(service).toBeDefined();
  });
});

// ── Executor Factory Tests ──

describe("P-12: Executor Factory", () => {
  it("30. creates all required executors", () => {
    const ctx = makeServiceContext();
    const request = makeRequest();
    const executors = createRpExecutors(ctx, request);
    expect(executors.playerInput).toBeDefined();
    expect(executors.playerOutput).toBeDefined();
    expect(executors.specializedAgent).toBeDefined();
    expect(executors.agentSessionLoadV1).toBeDefined();
    expect(executors.agentSessionCommitV1).toBeDefined();
    expect(executors.dynamicWorldbook).toBeDefined();
    expect(executors.memoryWrite).toBeDefined();
    expect(executors.memoryCorpus).toBeDefined();
    expect(executors.rpMemoryCommitPolicy).toBeDefined();
    expect(executors.rpCriticQualityGate).toBeDefined();
    expect(executors.rpSideEffectDecision).toBeDefined();
    expect(executors.failWorkflow).toBeDefined();
  });

  it("31. playerInput uses config text", async () => {
    const ctx = makeServiceContext();
    const executors = createRpExecutors(ctx, makeRequest());
    const result = await executors.playerInput!({
      node: {
        id: "test",
        type: "playerInput",
        config: { text: "hello" },
        position: { x: 0, y: 0 },
      },
      inputs: {},
    } as any);
    expect(result.outputs.text).toBe("hello");
  });

  it("32. playerOutput passes through text", async () => {
    const executors = createRpExecutors(makeServiceContext(), makeRequest());
    const result = await executors.playerOutput!({
      node: { id: "test", type: "playerOutput", config: {}, position: { x: 0, y: 0 } },
      inputs: { text: "output text" },
    } as any);
    expect(result.outputs.final).toBe("output text");
  });
});

// ── Legacy Compatibility Tests ──

describe("P-12: Legacy", () => {
  it("33. legacy registry entry exists", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.get("official-rp-legacy-v1");
    expect(entry.status).toBe("legacy");
    expect(existsSync(entry.workflowFile)).toBe(true);
  });

  it("34. legacy workflow loads", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.get("official-rp-legacy-v1");
    const wf = registry.loadWorkflow(entry);
    expect(wf.id).toBe("rp-retrieval-v1");
  });

  it("35. legacy request through adapter works", () => {
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.get("official-rp-legacy-v1");
    const workflow = registry.loadWorkflow(entry);
    const result = adaptRpInput(makeRequest(), workflow);
    expect(result.workflow).toBeDefined();
  });

  it("36. unified workflow validates with 0 errors", () => {
    const ctx = makeServiceContext();
    const registry = new OfficialWorkflowRegistry(makeDataDir());
    const entry = registry.getStableRpDefault();
    const workflow = registry.loadWorkflow(entry);
    const issues = validateWorkflow(workflow, ctx.runtimeNodeCatalog);
    expect(issues.filter((i: any) => i.level === "error")).toHaveLength(0);
  });
});

// ── Response Contract Tests ──

describe("P-12: Response Contract", () => {
  it("37. response has all required fields", () => {
    const response = adaptRpOutput(
      makeEmptyRunResult(),
      "s",
      "t",
      "w",
      1,
      "unified-v1",
      "trace-test",
    );
    expect(response.narrative).toBeDefined();
    expect(response.sessionId).toBe("s");
    expect(response.turnId).toBe("t");
    expect(response.workflow.id).toBe("w");
    expect(response.workflow.version).toBe(1);
    expect(response.workflow.mode).toBe("unified-v1");
    expect(response.traceId).toBeDefined();
  });

  it("38. legacy mode reflected in response", () => {
    const response = adaptRpOutput(makeEmptyRunResult(), "s", "t", "w", 1, "legacy", "trace-test");
    expect(response.workflow.mode).toBe("legacy");
  });
});
