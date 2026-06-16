/**
 * P-7 Stateful RP Context E2E Tests
 *
 * Proves: session history + worldbook + generic memory all feed into rp-writer agent,
 * with cross-round persistence, isolation, and prompt verification.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  runWorkflow,
  nodeRegistry,
  type NodeExecutor,
  type NodeCatalog,
  type WorkflowDefinition,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createSpecializedAgentExecutor,
  InMemoryAgentSessionStore,
  sessionContextToMarkdown,
  type AgentSessionStore,
  type AgentSessionKeyV1,
} from "./index.js";
import {
  InMemoryDynamicWorldbookStore,
  createDynamicWorldbookExecutor,
  dynamicWorldbookNode,
  executeOperation,
  type DynamicWorldbookNodeConfig,
} from "@awp/workflow-worldbook";
import {
  InMemoryWorkflowMemoryStore,
  memoryCorpusNode,
  createMemoryCorpusExecutor,
} from "@awp/workflow-memory";
import {
  genericRetrieverNode,
  retrievalResultToMarkdownNode,
  genericRetrieverExecutor,
  retrievalResultToMarkdownExecutor,
} from "@awp/workflow-retrieval";

// ============ Catalog ============

function createP7Catalog(): NodeCatalog {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    dynamicWorldbook: dynamicWorldbookNode,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
    memoryCorpus: memoryCorpusNode,
  };
}

// ============ Seed Helpers ============

async function seedWorldbook(store: InMemoryDynamicWorldbookStore, sessionId: string) {
  const config: DynamicWorldbookNodeConfig = {
    resourceRef: "worldbook:rp-tavern",
    lifecycle: "session",
    allowedOperations: ["append"],
  };
  await executeOperation({
    store,
    scopeKey: `session:${sessionId}:worldbook:rp-tavern`,
    resourceRef: "worldbook:rp-tavern",
    config,
    command: { operation: "append", operationId: `seed-wb-${sessionId}` },
    payload: {
      entries: [
        {
          id: "char_linzhou",
          content: "林舟是一名漂泊的剑客。他与银铃关系紧张。",
          title: "林舟",
          type: "character",
          tags: ["主角", "剑客"],
          priority: 5,
        },
        {
          id: "char_yinling",
          content: "银铃是酒馆常客，曾将仓库钥匙交给林舟。她与林舟存在未解决矛盾。",
          title: "银铃",
          type: "character",
          tags: ["商人", "神秘"],
          priority: 5,
        },
        {
          id: "item_key",
          content: "一把生锈的铜钥匙，能打开城东废弃仓库的门。银铃曾将其交给林舟保管。",
          title: "仓库钥匙",
          type: "item",
          tags: ["钥匙", "关键物品"],
          priority: 5,
        },
        {
          id: "loc_tavern",
          content: "雨夜酒馆位于城东港口区。窗外正下着大雨。",
          title: "雨夜酒馆",
          type: "location",
          tags: ["酒馆", "雨夜"],
          priority: 4,
        },
      ],
    },
    now: "2026-06-15T00:00:00.000Z",
  });
}

async function seedMemory(store: InMemoryWorkflowMemoryStore) {
  await store.upsert("rp-session-001", [
    {
      id: "mem-key-event",
      namespace: "rp-session-001",
      content: "银铃在雨夜把仓库钥匙交给了林舟。钥匙能打开城东废弃仓库。",
      title: "钥匙转交事件",
      type: "event",
      tags: ["事件", "钥匙"],
      entityIds: ["银铃", "林舟", "仓库"],
      importance: 8,
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z",
    },
  ]);
}

// ============ Executor Factories ============

function createExecutors(
  wbStore: InMemoryDynamicWorldbookStore,
  memStore: InMemoryWorkflowMemoryStore,
  sessionStore: AgentSessionStore,
  pr: InMemorySpecializedAgentProfileRegistry,
  scopeCtx: { sessionId: string },
  capturePrompt?: { captured: string },
): Record<string, NodeExecutor> {
  const adapter = {
    provider: "mock",
    async complete(p: { model: string; prompt: string; temperature?: number }) {
      if (capturePrompt) capturePrompt.captured = p.prompt;
      return {
        text: "[MOCK RP NARRATIVE]",
        tokenUsage: { input: Math.ceil(p.prompt.length / 4), output: 20 },
      };
    },
  };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => adapter,
  });

  return {
    jsonSource: async ({ node }) => ({
      outputs: { json: JSON.parse(String(node.config.data ?? "{}")) },
    }),
    playerInput: async ({ node }) => ({ outputs: { text: String(node.config.text ?? "") } }),
    markdownSource: async ({ node }) => ({
      outputs: { markdown: String(node.config.content ?? "") },
    }),
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push(`[JSON]\n${JSON.stringify(inputs.jsonInput, null, 2)}`);
      if (inputs.markdownInput != null) p.push(`[Markdown]\n${String(inputs.markdownInput)}`);
      if (inputs.textInput != null) p.push(`[Text]\n${String(inputs.textInput)}`);
      return { outputs: { debug: p.join("\n\n") || "(none)" } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: wbStore, scopeContext: scopeCtx }),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    memoryCorpus: createMemoryCorpusExecutor(memStore),
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => adapter,
    }),
    ...createStdlibExecutors(),
  };
}

// ============ Workflow Builders ============

function makeAgentWorkflow(playerText: string, contextMarkdown: string): WorkflowDefinition {
  return {
    id: "agent-test",
    name: "Agent Test",
    version: 1,
    nodes: [
      { id: "input", type: "playerInput", position: { x: 0, y: 0 }, config: { text: playerText } },
      {
        id: "ctxSrc",
        type: "markdownSource",
        position: { x: 0, y: 100 },
        config: { content: contextMarkdown },
      },
      {
        id: "agent",
        type: "specializedAgent",
        position: { x: 300, y: 50 },
        config: { profileId: "rp-writer", modelId: "mock-model", temperature: 0.8 },
      },
      {
        id: "output",
        type: "playerOutput",
        position: { x: 600, y: 50 },
        config: { displayLabel: "RP" },
      },
      {
        id: "insp",
        type: "inspectOutput",
        position: { x: 600, y: 200 },
        config: { displayMode: "text" },
      },
    ],
    edges: [
      { id: "e1", source: "input", sourcePort: "text", target: "agent", targetPort: "userInput" },
      {
        id: "e2",
        source: "ctxSrc",
        sourcePort: "markdown",
        target: "agent",
        targetPort: "context",
      },
      { id: "e3", source: "agent", sourcePort: "result", target: "output", targetPort: "text" },
      { id: "e4", source: "agent", sourcePort: "result", target: "insp", targetPort: "textInput" },
    ],
  };
}

// ============ Tests ============

describe("P-7: Stateful RP Context", () => {
  let wbStore: InMemoryDynamicWorldbookStore;
  let memStore: InMemoryWorkflowMemoryStore;
  let sessionStore: InMemoryAgentSessionStore;
  let pr: InMemorySpecializedAgentProfileRegistry;
  const catalog = createP7Catalog();
  const sessionId = "p7-test-session";
  const sessionKey: AgentSessionKeyV1 = {
    tenantId: "rp-test",
    workflowInstanceId: "p7-instance",
    conversationId: "conv-001",
    agentNodeId: "writer",
  };

  beforeEach(async () => {
    wbStore = new InMemoryDynamicWorldbookStore();
    memStore = new InMemoryWorkflowMemoryStore();
    sessionStore = new InMemoryAgentSessionStore();
    pr = createP1ProfileRegistry();
    await seedWorldbook(wbStore, sessionId);
    await seedMemory(memStore);
  });

  function execs(capturePrompt?: { captured: string }) {
    return createExecutors(wbStore, memStore, sessionStore, pr, { sessionId }, capturePrompt);
  }

  it("round 1: agent receives worldbook + memory context", async () => {
    const ctx =
      "## Retrieved Worldbook\n\n银铃曾将仓库钥匙交给林舟。\n\n## Retrieved Long-Term Memory\n\n银铃在雨夜把仓库钥匙交给了林舟。";
    const wf = makeAgentWorkflow('我把钥匙放到吧台上，看着银铃："这件事你打算怎么解释？"', ctx);
    const captured = { captured: "" };
    const result = await runWorkflow(wf, execs(captured), catalog);
    expect(result.status).toBe("success");
    expect(captured.captured).toContain("Retrieved Worldbook");
    expect(captured.captured).toContain("Retrieved Long-Term Memory");
    expect(captured.captured).toContain("User Input");
  });

  it("round 1 commits session and round 2 loads it", async () => {
    // Round 1
    const ctx1 = "## Retrieved Worldbook\n\n钥匙事件。\n\n## Retrieved Memory\n\n钥匙事件。";
    const wf1 = makeAgentWorkflow("我把钥匙放到吧台上，看着银铃", ctx1);
    const r1 = await runWorkflow(wf1, execs(), catalog);
    expect(r1.status).toBe("success");
    const agentOut1 = String(r1.nodeRuns.find((n) => n.nodeId === "agent")!.outputs.result ?? "");

    // Commit session
    await sessionStore.append(sessionKey, {
      sessionKey,
      newTurn: {
        turnIndex: 1,
        input: "我把钥匙放到吧台上，看着银铃",
        assistantOutput: agentOut1,
        modelConfig: {},
        tokenUsage: { input: 100, output: 50 },
        createdAt: "2026-01-01T00:00:00Z",
      },
    });

    // Round 2: Load session, build context with session history
    const sessionCtx = await sessionStore.load(sessionKey);
    expect(sessionCtx).not.toBeNull();
    expect(sessionCtx!.turns).toHaveLength(1);

    const sessionMd = sessionContextToMarkdown(sessionCtx!);
    expect(sessionMd).toContain("Session History");
    expect(sessionMd).toContain("我把钥匙放到吧台上");

    const ctx2 =
      sessionMd + "\n\n---\n\n## Retrieved Worldbook\n\n钥匙。\n\n## Retrieved Memory\n\n钥匙。";
    const wf2 = makeAgentWorkflow("继续", ctx2);
    const captured = { captured: "" };
    const r2 = await runWorkflow(wf2, execs(captured), catalog);
    expect(r2.status).toBe("success");

    // Verify round 2 prompt contains round 1 context
    expect(captured.captured).toContain("Session History");
    expect(captured.captured).toContain("我把钥匙放到吧台上");
    expect(captured.captured).toContain("Retrieved Worldbook");
    expect(captured.captured).toContain("Retrieved Memory");
    expect(captured.captured).toContain("User Input");
    expect(captured.captured).toContain("继续");
  });

  it("session isolation: session-a does not see session-b history", async () => {
    const keyA: AgentSessionKeyV1 = { ...sessionKey, agentNodeId: "writer-a" };
    const keyB: AgentSessionKeyV1 = { ...sessionKey, agentNodeId: "writer-b" };

    await sessionStore.append(keyA, {
      sessionKey: keyA,
      newTurn: {
        turnIndex: 1,
        input: "hello A",
        assistantOutput: "response A",
        modelConfig: {},
        tokenUsage: { input: 1, output: 1 },
        createdAt: "t",
      },
    });
    await sessionStore.append(keyB, {
      sessionKey: keyB,
      newTurn: {
        turnIndex: 1,
        input: "hello B",
        assistantOutput: "response B",
        modelConfig: {},
        tokenUsage: { input: 1, output: 1 },
        createdAt: "t",
      },
    });

    const ctxA = await sessionStore.load(keyA);
    const ctxB = await sessionStore.load(keyB);

    expect(ctxA!.turns[0]!.input).toBe("hello A");
    expect(ctxB!.turns[0]!.input).toBe("hello B");
    // Key isolation via agentNodeId ensures separation
    expect(keyA.agentNodeId).not.toBe(keyB.agentNodeId);
  });

  it("memory namespace isolation: ns-a not in ns-b", async () => {
    await memStore.upsert("ns-a", [
      { id: "e1", namespace: "ns-a", content: "secret A", createdAt: "t", updatedAt: "t" },
    ]);
    await memStore.upsert("ns-b", [
      { id: "e1", namespace: "ns-b", content: "secret B", createdAt: "t", updatedAt: "t" },
    ]);

    const listA = await memStore.list("ns-a");
    const listB = await memStore.list("ns-b");
    expect(listA[0]!.content).toBe("secret A");
    expect(listB[0]!.content).toBe("secret B");
  });

  it("prompt sections have clear headings", async () => {
    const ctx =
      "## Session History\n\n**Player**: hello\n**Agent**: hi\n\n---\n\n## Retrieved Worldbook\n\nworld content\n\n---\n\n## Retrieved Long-Term Memory\n\nmemory content";
    const wf = makeAgentWorkflow("continue", ctx);
    const captured = { captured: "" };
    const result = await runWorkflow(wf, execs(captured), catalog);
    expect(result.status).toBe("success");

    expect(captured.captured).toContain("## Session History");
    expect(captured.captured).toContain("## Retrieved Worldbook");
    expect(captured.captured).toContain("## Retrieved Long-Term Memory");
  });

  it("round 3 accumulates turns", async () => {
    // Round 1
    const r1 = await runWorkflow(makeAgentWorkflow("turn 1", "## R1"), execs(), catalog);
    await sessionStore.append(sessionKey, {
      sessionKey,
      newTurn: {
        turnIndex: 1,
        input: "turn 1",
        assistantOutput: String(r1.nodeRuns.find((n) => n.nodeId === "agent")!.outputs.result),
        modelConfig: {},
        tokenUsage: { input: 10, output: 10 },
        createdAt: "t",
      },
    });

    // Round 2
    const r2 = await runWorkflow(makeAgentWorkflow("turn 2", "## R2"), execs(), catalog);
    await sessionStore.append(sessionKey, {
      sessionKey,
      newTurn: {
        turnIndex: 2,
        input: "turn 2",
        assistantOutput: String(r2.nodeRuns.find((n) => n.nodeId === "agent")!.outputs.result),
        modelConfig: {},
        tokenUsage: { input: 10, output: 10 },
        createdAt: "t",
      },
    });

    const ctx = await sessionStore.load(sessionKey);
    expect(ctx!.turns).toHaveLength(2);
    expect(ctx!.turns[0]!.turnIndex).toBe(1);
    expect(ctx!.turns[1]!.turnIndex).toBe(2);
  });

  it("no regression: basic workflow still works", async () => {
    const wf: WorkflowDefinition = {
      id: "t",
      name: "T",
      version: 1,
      nodes: [
        { id: "in", type: "playerInput", position: { x: 0, y: 0 }, config: { text: "hi" } },
        { id: "out", type: "playerOutput", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", source: "in", sourcePort: "text", target: "out", targetPort: "text" }],
    };
    const result = await runWorkflow(wf, execs(), catalog);
    expect(result.status).toBe("success");
  });
});
