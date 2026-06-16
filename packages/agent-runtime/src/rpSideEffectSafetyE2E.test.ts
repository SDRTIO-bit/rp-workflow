/**
 * P-11.1 RP Side-Effect Safety Closure — E2E Tests
 *
 * Covers: Session idempotent, side-effect decision, exhausted-fail,
 * checkpoint resume safety, memory branch gating.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateWorkflow,
  runWorkflowWithBranches,
  runWorkflowWithCheckpoint,
  resumeWorkflow,
  computeWorkflowHash,
  nodeRegistry,
  type WorkflowDefinition,
  type NodeExecutor,
  type WorkflowRunContext,
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
  InMemoryWorkflowMemoryStore,
  createMemoryWriteExecutor,
  createMemoryCorpusExecutor,
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
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  rpCriticQualityGateNode,
  rpCriticQualityGateExecutor,
  rpMemoryCommitPolicyNode,
  rpMemoryCommitPolicyExecutor,
  rpSideEffectDecisionNode,
  rpSideEffectDecisionExecutor,
  failWorkflowNode,
  failWorkflowExecutor,
  InMemoryAgentSessionStore,
  computeSideEffectDecision,
  type RpRevisionLoopResultV1,
  type AgentSessionStore,
} from "../src/index.js";

// ---- helpers ----
function cat() {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    dynamicWorldbook: dynamicWorldbookNode,
    genericRetriever: genericRetrieverNode,
    retrievalResultToMarkdown: retrievalResultToMarkdownNode,
    memoryWrite: memoryWriteNode,
    memoryCorpus: memoryCorpusNode,
    rpCriticQualityGate: rpCriticQualityGateNode,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
    rpSideEffectDecision: rpSideEffectDecisionNode,
    failWorkflow: failWorkflowNode,
    agentSessionLoadV1: agentSessionLoadV1Definition,
    agentSessionCommitV1: agentSessionCommitV1Definition,
  };
}
function wf(n: string) {
  return JSON.parse(readFileSync(resolve(__dirname, "../../../data/workflows", n), "utf-8"))
    .workflow;
}
function mk(
  pr: InMemorySpecializedAgentProfileRegistry,
  rs: Array<{ text: string }>,
  o?: { ss?: AgentSessionStore; ms?: WorkflowMemoryStore; ws?: DynamicWorldbookStore },
) {
  let ci = -1;
  const ad = {
    provider: "mock",
    async complete(_p: { model: string; prompt: string; temperature?: number }) {
      ci++;
      if (ci >= rs.length) throw new Error("LLM call " + ci + " exceeds " + rs.length);
      return { text: rs[ci]!.text, tokenUsage: { input: 100, output: rs[ci]!.text.length } };
    },
  };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => ad,
  });
  const ss = o?.ss ?? new InMemoryAgentSessionStore();
  const ms = o?.ms ?? new InMemoryWorkflowMemoryStore();
  const ws = o?.ws ?? new InMemoryDynamicWorldbookStore();
  const cx: WorkflowRunContext = { sessionId: "session-a" };
  // TurnId counter for multi-turn tests
  if (!(globalThis as any).__rpTurnIdCounter) {
    (globalThis as any).__rpTurnIdCounter = 0;
  }
  const e: Record<string, NodeExecutor> = {
    playerInput: async ({ node }) => ({
      outputs: { text: String((node.config as any).text ?? "") },
    }),
    markdownSource: async ({ node }) => ({
      outputs: { markdown: String((node.config as any).content ?? "") },
    }),
    jsonSource: async ({ node }) => {
      let d: unknown;
      try {
        d = JSON.parse(String((node.config as any).data ?? "{}"));
      } catch {
        d = {};
      }
      return { outputs: { json: d } };
    },
    playerOutput: async ({ inputs }) => ({ outputs: { final: inputs.text ?? "" } }),
    inspectOutput: async ({ inputs }) => {
      const p: string[] = [];
      if (inputs.jsonInput != null) p.push("[JSON]" + JSON.stringify(inputs.jsonInput));
      if (inputs.markdownInput != null) p.push("[MD]" + String(inputs.markdownInput));
      if (inputs.textInput != null) p.push("[TXT]" + String(inputs.textInput));
      return { outputs: { debug: p.join("|") || "(none)" } };
    },
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => ad,
    }),
    rpCriticQualityGate: rpCriticQualityGateExecutor,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyExecutor,
    rpSideEffectDecision: rpSideEffectDecisionExecutor,
    failWorkflow: failWorkflowExecutor,
    agentSessionLoadV1: createAgentSessionLoadV1Executor({ store: ss }),
    agentSessionCommitV1: createAgentSessionCommitV1Executor({ store: ss }),
    sessionToMarkdown: async ({ inputs }) => {
      const c = inputs.sessionContext as any;
      return {
        outputs: {
          markdown: c
            ? c.turns?.length
              ? "## Session History\n..."
              : "(No session history.)"
            : "(No session history.)",
        },
      };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: ws, scopeContext: cx }),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    memoryWrite: createMemoryWriteExecutor(ms),
    memoryCorpus: createMemoryCorpusExecutor(ms),
  };
  Object.assign(e, createStdlibExecutors());
  // Override jsonSource for turnId auto-increment
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpTurnIdCounter++;
      result.outputs.json = `turn-${String((globalThis as any).__rpTurnIdCounter).padStart(3, "0")}`;
    }
    return result;
  };
  return { e, cx, ss, ms, ws };
}
async function go(w: WorkflowDefinition, e: Record<string, NodeExecutor>, c: WorkflowRunContext) {
  return runWorkflowWithBranches(w, e, cat(), c);
}

const W1 = "[yin ling looked at the key]";
const CA = JSON.stringify({
  decision: "accept",
  scores: {
    continuity: 0.9,
    characterConsistency: 0.85,
    playerAgency: 0.95,
    knowledgeBoundary: 0.9,
    styleAndFormat: 0.8,
  },
  issues: [],
});
const CR = JSON.stringify({
  decision: "revise",
  scores: {
    continuity: 0.8,
    characterConsistency: 0.7,
    playerAgency: 0.3,
    knowledgeBoundary: 0.8,
    styleAndFormat: 0.8,
  },
  issues: [
    { code: "player-agency", severity: "error", message: "Controls player", suggestion: "Remove" },
  ],
  revisionInstruction: "Let the player decide.",
});
const W2 = "[revised draft yin ling waits]";
const C2 = JSON.stringify({
  decision: "revise",
  scores: {
    continuity: 0.8,
    characterConsistency: 0.7,
    playerAgency: 0.4,
    knowledgeBoundary: 0.8,
    styleAndFormat: 0.7,
  },
  issues: [{ code: "player-agency", severity: "error", message: "x", suggestion: "y" }],
  revisionInstruction: "Fix",
});
const CUR = JSON.stringify([
  {
    kind: "event",
    summary: "Player gave key",
    entityIds: ["player", "yin_ling"],
    importance: 0.8,
    confidence: 0.9,
  },
]);

// ============ P-11.1: Side-Effect Decision (Unit) ============

describe("P-11.1: Side-Effect Decision", () => {
  const acceptedResult: RpRevisionLoopResultV1 = {
    finalDraft: "ok",
    accepted: true,
    exhausted: false,
    writerAttempts: 1,
    criticAttempts: 1,
    finalDraftSource: "attempt-1",
    gateResult: {} as any,
    firstGateResult: {} as any,
    revisionApplied: false,
  };
  const exhaustedResult: RpRevisionLoopResultV1 = {
    finalDraft: "d2",
    accepted: false,
    exhausted: true,
    writerAttempts: 2,
    criticAttempts: 2,
    finalDraftSource: "attempt-2",
    gateResult: {} as any,
    firstGateResult: {} as any,
    revisionApplied: true,
  };

  it("1. accepted → all three allowed", () => {
    const d = computeSideEffectDecision(acceptedResult);
    expect(d.allowPlayerOutput).toBe(true);
    expect(d.allowSessionCommit).toBe(true);
    expect(d.allowMemoryCommit).toBe(true);
    expect(d.reason).toBe("accepted");
  });

  it("2. exhausted return-latest → player/session allowed, memory denied", () => {
    const d = computeSideEffectDecision(exhaustedResult, { onExhausted: "return-latest" });
    expect(d.allowPlayerOutput).toBe(true);
    expect(d.allowSessionCommit).toBe(true);
    expect(d.allowMemoryCommit).toBe(false);
    expect(d.reason).toBe("exhausted-return-latest");
    expect(d.exhausted).toBe(true);
  });

  it("3. exhausted fail → all three denied", () => {
    const d = computeSideEffectDecision(exhaustedResult, { onExhausted: "fail" });
    expect(d.allowPlayerOutput).toBe(false);
    expect(d.allowSessionCommit).toBe(false);
    expect(d.allowMemoryCommit).toBe(false);
    expect(d.reason).toBe("exhausted-fail");
  });

  it("4. illegal state → throws", () => {
    const bad: RpRevisionLoopResultV1 = { ...acceptedResult, accepted: true, exhausted: true };
    expect(() => computeSideEffectDecision(bad)).toThrow();
  });

  it("5. input not modified", () => {
    const orig = JSON.stringify(acceptedResult);
    computeSideEffectDecision(acceptedResult);
    expect(JSON.stringify(acceptedResult)).toBe(orig);
  });

  it("6. output stable", () => {
    const d1 = computeSideEffectDecision(acceptedResult);
    const d2 = computeSideEffectDecision(acceptedResult);
    expect(d1).toEqual(d2);
  });
});

// ============ P-11.1: Session Idempotent ============

describe("P-11.1: Session Idempotent", () => {
  let store: InMemoryAgentSessionStore;
  const key = { tenantId: "t", workflowInstanceId: "w", conversationId: "conv", agentNodeId: "a" };
  const turn = (output: string) => ({
    sessionKey: key,
    newTurn: {
      turnIndex: 1,
      input: "hi",
      assistantOutput: output,
      modelConfig: { model: "m" },
      tokenUsage: { input: 10, output: 20 },
      createdAt: new Date().toISOString(),
    },
  });

  beforeEach(() => {
    store = new InMemoryAgentSessionStore();
  });

  it("7. first write succeeds", async () => {
    const r = await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    expect(r.committed).toBe(true);
  });

  it("8. same content dedup", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    const r = await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    expect(r.deduplicated).toBe(true);
    expect(r.committed).toBe(false);
  });

  it("9. different content same turnId → conflict", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    const r = await store.commitIdempotent(
      key,
      turn("B"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_B",
    );
    expect((r as any).conflict).toBe(true);
    expect(r.committed).toBe(false);
  });

  it("10. different sessionId isolated", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv1", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    const r = await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv2", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    expect(r.committed).toBe(true);
  });

  it("11. different agentNodeId isolated", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a1", turnId: "t1" },
      "hash_A",
    );
    const r = await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a2", turnId: "t1" },
      "hash_A",
    );
    expect(r.committed).toBe(true);
  });

  it("12. different turnId normal append", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    const r = await store.commitIdempotent(
      key,
      turn("B"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t2" },
      "hash_B",
    );
    expect(r.committed).toBe(true);
  });

  it("13. session persists only one copy of turn", async () => {
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    await store.commitIdempotent(
      key,
      turn("A"),
      { sessionId: "conv", agentNodeId: "a", turnId: "t1" },
      "hash_A",
    );
    const ctx = await store.load(key);
    expect(ctx!.turns.length).toBe(1);
    expect(ctx!.turns[0]!.assistantOutput).toBe("A");
  });
});

// ============ P-11.1: E2E Scenarios ============

describe("P-11.1: E2E — Accepted", () => {
  const pr = createP1ProfileRegistry();

  it("14. curator executes on accepted", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.status).toBe("success");
    const cur = r.nodeRuns.find((n: any) => n.nodeId === "curator");
    expect(cur!.status).toBe("success");
  });

  it("15. memory write happens on accepted", async () => {
    const ms = new InMemoryWorkflowMemoryStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ms });
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect((await ms.list("rp-memory")).length).toBeGreaterThan(0);
  });
});

describe("P-11.1: E2E — Exhausted Return-Latest", () => {
  const pr = createP1ProfileRegistry();

  it("16. curator skipped on exhausted return-latest", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const cur = r.nodeRuns.find((n: any) => n.nodeId === "curator");
    expect(cur!.status).toBe("skipped");
  });

  it("17. memPolicy skipped on exhausted return-latest", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "memPolicy")!.status).toBe("skipped");
  });

  it("18. memWrite skipped on exhausted return-latest", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "memWrite")!.status).toBe("skipped");
  });

  it("19. memory count unchanged on exhausted", async () => {
    const ms = new InMemoryWorkflowMemoryStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }], { ms });
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect((await ms.list("rp-memory")).length).toBe(0);
  });

  it("20. player output = Draft2 despite exhaustion", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "output")!.outputs.final).toBe(W2);
  });

  it("21. session commit succeeds on exhausted return-latest", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }], { ss });
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const ctx = await ss.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: "session-a",
      agentNodeId: "writer-main",
    });
    expect(ctx!.turns[0]!.assistantOutput).toBe(W2);
  });
});

// ============ P-11.1: E2E — Exhausted-Fail ============

describe("P-11.1: E2E — Exhausted-Fail", () => {
  const pr = createP1ProfileRegistry();

  it("22. workflow fails on exhausted-fail", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    // Override decision config for this test
    const modWf = wf("rp-unified-stateful-production-v1.json");
    const decisionNode = modWf.nodes.find((n: any) => n.id === "decision");
    decisionNode!.config.onExhausted = "fail";
    const r = await go(modWf, e, cx);
    expect(r.status).toBe("error");
  });

  it("23. player output skipped on exhausted-fail", async () => {
    const modWf = wf("rp-unified-stateful-production-v1.json");
    const decisionNode = modWf.nodes.find((n: any) => n.id === "decision");
    decisionNode!.config.onExhausted = "fail";
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(modWf, e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "output")!.status).toBe("skipped");
  });

  it("24. session commit skipped on exhausted-fail", async () => {
    const modWf = wf("rp-unified-stateful-production-v1.json");
    const decisionNode = modWf.nodes.find((n: any) => n.id === "decision");
    decisionNode!.config.onExhausted = "fail";
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(modWf, e, cx);
    const sc = r.nodeRuns.find((n: any) => n.nodeId === "sessionCommit");
    // Either skipped due to branch routing, or absent because workflow errored early
    expect(sc ? sc.status : "absent").not.toBe("success");
  });

  it("25. curator skipped on exhausted-fail", async () => {
    const modWf = wf("rp-unified-stateful-production-v1.json");
    const decisionNode = modWf.nodes.find((n: any) => n.id === "decision");
    decisionNode!.config.onExhausted = "fail";
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(modWf, e, cx);
    const cur = r.nodeRuns.find((n: any) => n.nodeId === "curator");
    // Either skipped due to branch routing, or absent because workflow errored early
    expect(cur ? cur.status : "absent").not.toBe("success");
  });

  it("26. failWorkflow executes on exhausted-fail", async () => {
    const modWf = wf("rp-unified-stateful-production-v1.json");
    const decisionNode = modWf.nodes.find((n: any) => n.id === "decision");
    decisionNode!.config.onExhausted = "fail";
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(modWf, e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "fail")!.status).toBe("error");
  });
});

// ============ P-11.1: Draft Confidentiality ============

describe("P-11.1: Draft Confidentiality", () => {
  const pr = createP1ProfileRegistry();

  it("27. Draft1 not in final session", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(
      pr,
      [{ text: W1 }, { text: CR }, { text: W2 }, { text: CA }, { text: CUR }],
      { ss },
    );
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const ctx = await ss.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: "session-a",
      agentNodeId: "writer-main",
    });
    expect(ctx!.turns[0]!.assistantOutput).toBe(W2);
    expect(ctx!.turns[0]!.assistantOutput).not.toBe(W1);
  });

  it("28. revision Draft2 enters session", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(
      pr,
      [{ text: W1 }, { text: CR }, { text: W2 }, { text: CA }, { text: CUR }],
      { ss },
    );
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const ctx = await ss.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: "session-a",
      agentNodeId: "writer-main",
    });
    expect(ctx!.turns[0]!.assistantOutput).toBe(W2);
  });
});

// ============ P-11.1: Workflow Validation ============

describe("P-11.1: Workflow Validation", () => {
  it("29. formal JSON 0 errors", () => {
    const issues = validateWorkflow(wf("rp-unified-stateful-production-v1.json"), cat());
    expect(issues.filter((i: any) => i.level === "error")).toHaveLength(0);
  });

  it("30. P-10 workflow still validates", () => {
    const issues = validateWorkflow(wf("rp-writer-critic-bounded-revision-v1.json"), cat());
    expect(issues.filter((i: any) => i.level === "error")).toHaveLength(0);
  });
});

// ============ P-11.1: Skipped Metadata ============

describe("P-11.1: Skipped Metadata", () => {
  it("31. curator-online skipped nodes have correct metadata", async () => {
    const pr = createP1ProfileRegistry();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const skipped = r.nodeRuns.filter((n: any) => n.status === "skipped");
    const skippedIds = skipped.map((n: any) => n.nodeId);
    expect(skippedIds).toEqual(
      expect.arrayContaining(["curator", "curatorJson", "memPolicy", "memWrite"]),
    );
  });

  it("32. skipped reason is inactive-branch", async () => {
    const pr = createP1ProfileRegistry();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const skipped = r.nodeRuns.filter((n: any) => n.status === "skipped");
    for (const s of skipped) {
      expect(s.metadata?.skippedReason).toBe("inactive-branch");
    }
  });
});

// ============ P-11.1: Checkpoint Resume ============

describe("P-11.1: Checkpoint Resume", () => {
  const pr = createP1ProfileRegistry();

  it("33. session commit dedup on resume", async () => {
    const ss = new InMemoryAgentSessionStore();
    const w = wf("rp-unified-stateful-production-v1.json");
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ss });

    // First run with checkpoint capturing all completed nodes
    let checkpoint: any;
    const completedIds: string[] = [];
    const nodeOutputs: Record<string, any> = {};
    await runWorkflowWithCheckpoint(w, e, cat(), cx, {
      onNodeCompleted: async (runId, nodeId, outputs) => {
        completedIds.push(nodeId);
        nodeOutputs[nodeId] = outputs;
        // Capture checkpoint after sessionCommit
        if (nodeId === "sessionCommit") {
          checkpoint = {
            runId,
            workflowId: w.id,
            workflowHash: computeWorkflowHash(w),
            completedNodeIds: [...completedIds],
            skippedNodeIds: [],
            nodeOutputs: { ...nodeOutputs },
          };
        }
      },
    });
    expect(
      (await ss.load({
        tenantId: "default",
        workflowInstanceId: "rp-prod-1",
        conversationId: "session-a",
        agentNodeId: "writer-main",
      }))!.turns.length,
    ).toBe(1);

    // Resume — session should not duplicate
    await resumeWorkflow(w, e, checkpoint, cat(), cx);
    expect(
      (await ss.load({
        tenantId: "default",
        workflowInstanceId: "rp-prod-1",
        conversationId: "session-a",
        agentNodeId: "writer-main",
      }))!.turns.length,
    ).toBe(1);
  });

  it("34. memory branch stays skipped after exhausted resume", async () => {
    const w = wf("rp-unified-stateful-production-v1.json");
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CR }, { text: W2 }, { text: C2 }]);

    // Run with checkpoint, capture at routeMemory
    let checkpoint: any;
    const completedIds: string[] = [];
    const skippedIds: string[] = [];
    const nodeOutputs: Record<string, any> = {};
    await runWorkflowWithCheckpoint(w, e, cat(), cx, {
      onNodeCompleted: async (runId, nodeId, outputs) => {
        completedIds.push(nodeId);
        nodeOutputs[nodeId] = outputs;
        if (nodeId === "routeMemory") {
          checkpoint = {
            runId,
            workflowId: w.id,
            workflowHash: computeWorkflowHash(w),
            completedNodeIds: [...completedIds],
            skippedNodeIds: [...skippedIds],
            nodeOutputs: { ...nodeOutputs },
          };
        }
      },
    });

    expect(checkpoint).toBeDefined();
    // Resume — curator should remain skipped
    const r2 = await resumeWorkflow(w, e, checkpoint, cat(), cx);
    const curator = r2.nodeRuns.find((n: any) => n.nodeId === "curator");
    expect(curator ? curator.status : "absent").toBe("skipped");
  });
});
