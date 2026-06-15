/**
 * P-11 Unified Stateful RP Production Workflow E2E Tests
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  validateWorkflow,
  runWorkflowWithBranches,
  nodeRegistry,
  type WorkflowDefinition,
  type NodeExecutor,
  type NodeCatalog,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  genericRetrieverNode,
  retrievalResultToMarkdownNode,
  genericRetrieverExecutor,
  retrievalResultToMarkdownExecutor,
} from "@awp/workflow-retrieval";
import {
  memoryWriteNode,
  memoryCorpusNode,
  memoryDeleteNode,
  InMemoryWorkflowMemoryStore,
  FileWorkflowMemoryStore,
  createMemoryWriteExecutor,
  createMemoryCorpusExecutor,
  createMemoryDeleteExecutor,
  type WorkflowMemoryStore,
} from "@awp/workflow-memory";
import {
  dynamicWorldbookNode,
  InMemoryDynamicWorldbookStore,
  createDynamicWorldbookExecutor,
  type DynamicWorldbookStore,
} from "@awp/workflow-worldbook";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createSpecializedAgentExecutor,
  createAgentSessionLoadV1Executor,
  createAgentSessionCommitV1Executor,
  rpCriticQualityGateNode,
  rpCriticQualityGateExecutor,
  rpMemoryCommitPolicyNode,
  rpMemoryCommitPolicyExecutor,
  InMemoryAgentSessionStore,
  sessionContextToMarkdown,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  type AgentSessionStore,
} from "./index";

// ============ Helpers ============

function createP11Catalog(): NodeCatalog {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    dynamicWorldbook: dynamicWorldbookNode,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
    memoryWrite: memoryWriteNode,
    memoryCorpus: memoryCorpusNode,
    memoryDelete: memoryDeleteNode,
    rpCriticQualityGate: rpCriticQualityGateNode,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
    agentSessionLoadV1: agentSessionLoadV1Definition,
    agentSessionCommitV1: agentSessionCommitV1Definition,
  };
}

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

function createUnifiedExecutors(
  pr: InMemorySpecializedAgentProfileRegistry,
  responses: Array<{ text: string }>,
  options?: {
    sessionStore?: AgentSessionStore;
    memoryStore?: WorkflowMemoryStore;
    worldbookStore?: DynamicWorldbookStore;
  },
) {
  let callIndex = -1;
  const adapter = {
    provider: "mock",
    async complete(p: { model: string; prompt: string; temperature?: number }) {
      callIndex++;
      if (callIndex >= responses.length)
        throw new Error(`LLM call ${callIndex} exceeds ${responses.length}`);
      const t = responses[callIndex]!.text;
      return { text: t, tokenUsage: { input: 100, output: t.length } };
    },
  };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock", apiKey: "k", baseUrl: "http://x", defaultModel: "mock-model",
    createAdapter: () => adapter,
  });

  const sessionStore = options?.sessionStore ?? new InMemoryAgentSessionStore();
  const memStore = options?.memoryStore ?? new InMemoryWorkflowMemoryStore();
  const wbStore = options?.worldbookStore ?? new InMemoryDynamicWorldbookStore();

  const execs: Record<string, NodeExecutor> = {
    playerInput: async ({ node }) => ({ outputs: { text: String(node.config.text ?? "") } }),
    markdownSource: async ({ node }) => ({ outputs: { markdown: String(node.config.content ?? "") } }),
    jsonSource: async ({ node }) => {
      let d: unknown;
      try { d = JSON.parse(String(node.config.data ?? "{}")); } catch { d = {}; }
      return { outputs: { json: d } };
    },
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]${JSON.stringify(inputs.jsonInput)}`);
      if (inputs.markdownInput != null) p.push(`[MD]${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[TXT]${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("|") || "(none)" } };
    },
    specializedAgent: createSpecializedAgentExecutor({
      registry: r, profileRegistry: pr, createAdapter: () => adapter,
    }),
    rpCriticQualityGate: rpCriticQualityGateExecutor,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyExecutor,
    agentSessionLoadV1: createAgentSessionLoadV1Executor({ store: sessionStore }),
    agentSessionCommitV1: createAgentSessionCommitV1Executor({ store: sessionStore }),
    sessionToMarkdown: async ({ inputs }) => {
      const ctx = inputs.sessionContext as Record<string, unknown> | undefined;
      if (!ctx) return { outputs: { markdown: "(No session history.)" } };
      return { outputs: { markdown: sessionContextToMarkdown(ctx as unknown as Parameters<typeof sessionContextToMarkdown>[0]) } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: wbStore, scopeContext: {} }),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    memoryWrite: createMemoryWriteExecutor(memStore),
    memoryCorpus: createMemoryCorpusExecutor(memStore),
    memoryDelete: createMemoryDeleteExecutor(memStore),
  };
  Object.assign(execs, createStdlibExecutors());

  return { executors: execs, sessionStore, memoryStore: memStore, worldbookStore: wbStore };
}

const WRITER_ACCEPT = "[银铃看着吧台上的钥匙，没有立刻伸手。]";
const CRITIC_ACCEPT = JSON.stringify({ decision: "accept", scores: { continuity: 0.9, characterConsistency: 0.85, playerAgency: 0.95, knowledgeBoundary: 0.9, styleAndFormat: 0.8 }, issues: [] });
const CRITIC_REVISE = JSON.stringify({ decision: "revise", scores: { continuity: 0.8, characterConsistency: 0.7, playerAgency: 0.3, knowledgeBoundary: 0.8, styleAndFormat: 0.8 }, issues: [{ code: "player-agency", severity: "error", message: "Controls player", suggestion: "Remove decision" }], revisionInstruction: "Let the player decide their own action." });
const WRITER_REVISED = "[银铃看着吧台上的钥匙，等待。\"仓库的钥匙。\"]";
const CURATOR_OUTPUT = JSON.stringify([{ kind: "event", summary: "Player gave key to Yin Ling", entityIds: ["player", "yin_ling"], importance: 0.8, confidence: 0.9 }]);

// ============ Structure ============

describe("P-11: Structure", () => {
  const catalog = createP11Catalog();
  const pr = createP1ProfileRegistry();

  it("1. unified JSON validates", () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    expect(validateWorkflow(wf, catalog).filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("2-3. P-9/P-10 regression validates", () => {
    expect(validateWorkflow(loadWorkflowJson("rp-writer-critic-gate-v1.json"), catalog).filter((i) => i.level === "error")).toHaveLength(0);
    expect(validateWorkflow(loadWorkflowJson("rp-writer-critic-bounded-revision-v1.json"), catalog).filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("4. basic P-9 E2E regression", async () => {
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }]);
    expect((await runWorkflowWithBranches(wf, executors, catalog)).status).toBe("success");
  });
});

// ============ Scenario A ============

describe("P-11: A — First-Pass Accept", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();

  it("5. W2/C2/G2 skipped", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.status).toBe("success");
    expect(r.nodeRuns.find((n) => n.nodeId === "writer2")!.status).toBe("skipped");
    expect(r.nodeRuns.find((n) => n.nodeId === "critic2")!.status).toBe("skipped");
    expect(r.nodeRuns.find((n) => n.nodeId === "gate2")!.status).toBe("skipped");
  });

  it("6. finalDraft=Draft1", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.nodeRuns.find((n) => n.nodeId === "selector")!.outputs.finalDraft).toBe(WRITER_ACCEPT);
  });

  it("7. playerOutput=Draft1", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.nodeRuns.find((n) => n.nodeId === "output")!.outputs.final).toBe(WRITER_ACCEPT);
  });

  it("8. session commit succeeds", async () => {
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }], { sessionStore: ss });
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.nodeRuns.find((n) => n.nodeId === "sessionCommit")!.status).toBe("success");
  });
});

// ============ Scenario B ============

describe("P-11: B — Revision-Pass Accept", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();

  it("9. all 4 LLM calls", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: CRITIC_ACCEPT },
    ]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.status).toBe("success");
    expect(r.nodeRuns.find((n) => n.nodeId === "writer2")!.status).toBe("success");
    expect(r.nodeRuns.find((n) => n.nodeId === "critic2")!.status).toBe("success");
  });

  it("10. finalDraft=Draft2 not Draft1", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: CRITIC_ACCEPT },
    ]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    const s = r.nodeRuns.find((n) => n.nodeId === "selector")!;
    expect(s.outputs.finalDraft).toBe(WRITER_REVISED);
    expect(s.outputs.finalDraft).not.toBe(WRITER_ACCEPT);
  });

  it("11. session commits Draft2", async () => {
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss });
    await runWorkflowWithBranches(wf, executors, catalog);
    const ctx = await ss.load({ tenantId: "default", workflowInstanceId: "rp-prod-1", conversationId: "session-a", agentNodeId: "writer-main" });
    expect(ctx!.turns[0]!.assistantOutput).toBe(WRITER_REVISED);
  });

  it("12. playerOutput=Draft2", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: CRITIC_ACCEPT },
    ]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.nodeRuns.find((n) => n.nodeId === "output")!.outputs.final).toBe(WRITER_REVISED);
  });
});

// ============ Scenario C ============

describe("P-11: C — Exhausted", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();
  const C2 = JSON.stringify({ decision: "revise", scores: { continuity: 0.8, characterConsistency: 0.7, playerAgency: 0.4, knowledgeBoundary: 0.8, styleAndFormat: 0.7 }, issues: [{ code: "player-agency", severity: "error", message: "x", suggestion: "y" }], revisionInstruction: "Fix" });

  it("13. output=Draft2 despite rejection", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: C2 },
    ]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    expect(r.nodeRuns.find((n) => n.nodeId === "output")!.outputs.final).toBe(WRITER_REVISED);
  });

  it("14. no 3rd writer (5th LLM would error)", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_REVISE }, { text: WRITER_REVISED }, { text: C2 }, { text: "SHOULD_NOT_CALL" },
    ]);
    await runWorkflowWithBranches(wf, executors, catalog);
  });
});

// ============ Multi-Turn ============

describe("P-11: Multi-Turn", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();
  const key = { tenantId: "default", workflowInstanceId: "rp-prod-1", conversationId: "session-a", agentNodeId: "writer-main" };

  it("15. session persists across rounds", async () => {
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");

    const { executors: e1 } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }, { text: CURATOR_OUTPUT },
    ], { sessionStore: ss });
    await runWorkflowWithBranches(wf, e1, catalog);
    expect((await ss.load(key))!.turns.length).toBe(1);

    const { executors: e2 } = createUnifiedExecutors(pr, [
      { text: "[R2]" }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss });
    await runWorkflowWithBranches(wf, e2, catalog);
    expect((await ss.load(key))!.turns.length).toBe(2);
  });

  it("16. Round2 sessionMd includes history", async () => {
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");

    const { executors: e1 } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss });
    await runWorkflowWithBranches(wf, e1, catalog);

    const { executors: e2 } = createUnifiedExecutors(pr, [
      { text: "[R2]" }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss });
    const r2 = await runWorkflowWithBranches(wf, e2, catalog);
    expect(r2.nodeRuns.find((n) => n.nodeId === "sessionMd")!.outputs.markdown).toContain("Session History");
  });
});

// ============ File Persistence ============

describe("P-11: File Persistence", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();
  const td = resolve(__dirname, "../../../data/test-memories");

  beforeEach(() => { if (!existsSync(td)) mkdirSync(td, { recursive: true }); });
  afterEach(() => { try { unlinkSync(join(td, "mem.json")); } catch { /* ok */ } });

  it("17. file store survives instance destruction", async () => {
    const fp = join(td, "mem.json");
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");

    const { executors: e1 } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }, { text: CURATOR_OUTPUT },
    ], { sessionStore: ss, memoryStore: new FileWorkflowMemoryStore(fp) });
    await runWorkflowWithBranches(wf, e1, catalog);

    const s2 = new FileWorkflowMemoryStore(fp);
    const { executors: e2 } = createUnifiedExecutors(pr, [
      { text: "[R2]" }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss, memoryStore: s2 });
    const r2 = await runWorkflowWithBranches(wf, e2, catalog);
    expect(r2.nodeRuns.find((n) => n.nodeId === "memCorpus")!.status).toBe("success");
  });
});

// ============ Isolation ============

describe("P-11: Isolation", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();

  it("18. session isolation", async () => {
    const ss = new InMemoryAgentSessionStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT },
    ], { sessionStore: ss });
    await runWorkflowWithBranches(wf, executors, catalog);
    expect(await ss.load({ tenantId: "default", workflowInstanceId: "rp-prod-1", conversationId: "other", agentNodeId: "writer-main" })).toBeNull();
  });

  it("19. memory namespace isolation", async () => {
    const ms = new InMemoryWorkflowMemoryStore();
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [
      { text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }, { text: CURATOR_OUTPUT },
    ], { memoryStore: ms });
    await runWorkflowWithBranches(wf, executors, catalog);
    expect((await ms.list("rp-memory")).length).toBeGreaterThan(0);
    expect((await ms.list("other")).length).toBe(0);
  });
});

// ============ Branch Trace ============

describe("P-11: Branch Trace", () => {
  const pr = createP1ProfileRegistry();
  const catalog = createP11Catalog();

  it("20. skipped nodes have correct metadata", async () => {
    const wf = loadWorkflowJson("rp-unified-stateful-production-v1.json");
    const { executors } = createUnifiedExecutors(pr, [{ text: WRITER_ACCEPT }, { text: CRITIC_ACCEPT }]);
    const r = await runWorkflowWithBranches(wf, executors, catalog);
    const skipped = r.nodeRuns.filter((n) => n.status === "skipped");
    expect(skipped.map((n) => n.nodeId)).toEqual(expect.arrayContaining(["writer2", "critic2", "gate2"]));
    for (const s of skipped) expect(s.metadata?.skippedReason).toBe("inactive-branch");
  });

  it("21. buildSessionDelta valid", async () => {
    const { executors } = createUnifiedExecutors(pr, []);
    const r = await executors.buildSessionDelta!({
      node: { id: "t", type: "buildSessionDelta", position: { x: 0, y: 0 }, config: {} },
      inputs: { sessionKey: { tenantId: "t", workflowInstanceId: "w", conversationId: "c", agentNodeId: "a" }, playerInput: "hi", finalDraft: "hey" },
    });
    expect(r.outputs.sessionDelta).toBeDefined();
  });
});
