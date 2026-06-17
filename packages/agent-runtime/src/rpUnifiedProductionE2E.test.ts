/**
 * P-11 Unified Stateful RP Production Workflow E2E Tests
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  validateWorkflow,
  runWorkflowWithBranches,
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
  rpSideEffectDecisionNode,
  rpSideEffectDecisionExecutor,
  failWorkflowNode,
  failWorkflowExecutor,
  InMemoryAgentSessionStore,
  sessionContextToMarkdown,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  type AgentSessionStore,
} from "./index.js";

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
    memoryDelete: memoryDeleteNode,
    rpCriticQualityGate: rpCriticQualityGateNode,
    rpMemoryCommitPolicy: rpMemoryCommitPolicyNode,
    rpSideEffectDecision: rpSideEffectDecisionNode,
    failWorkflow: failWorkflowNode,
    criticInstructionBuilder: {
      type: "criticInstructionBuilder",
      label: "Critic Instruction Builder",
      category: "core",
      description: "P-15.1 prompt trim",
      color: "#a855f7",
      panelLayout: "generic" as const,
      defaultConfig: {},
      configFields: [],
      ports: [
        {
          id: "rubric",
          label: "Rubric",
          direction: "input" as const,
          wireType: "markdown" as const,
          required: true,
        },
        {
          id: "gateResult",
          label: "Gate Result",
          direction: "input" as const,
          wireType: "json" as const,
          required: true,
        },
        {
          id: "instruction",
          label: "Instruction",
          direction: "output" as const,
          wireType: "markdown" as const,
        },
      ],
    },
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
      const t = rs[ci]!.text;
      return { text: t, tokenUsage: { input: 100, output: t.length } };
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
  // P-11.1: Module-level counter shared across mk() calls for multi-turn test support
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
    criticInstructionBuilder: async ({ inputs }) => {
      const rubric = String(inputs.rubric ?? "");
      const gateResult = inputs.gateResult as
        | {
            revisionInstruction?: string;
            review?: { issues?: Array<{ code: string; severity: string; message?: string }> };
          }
        | undefined;
      const parts: string[] = [];
      if (rubric.trim().length > 0) parts.push(rubric);
      if (gateResult?.revisionInstruction && gateResult.revisionInstruction.trim().length > 0) {
        parts.push("## Revision Instruction (from Critic 1)");
        parts.push(gateResult.revisionInstruction);
        const issues = gateResult.review?.issues ?? [];
        if (issues.length > 0) {
          parts.push("## Issues to verify (from Critic 1)");
          for (const issue of issues) {
            const sev = issue.severity === "error" ? "[ERROR]" : "[WARNING]";
            parts.push(`${sev} ${issue.code}: ${issue.message ?? ""}`);
          }
        }
        parts.push("## Review focus (attempt 2)");
        parts.push(
          "- Focus on whether the original issues above are now fixed.",
          "- Do NOT reject for new minor style or wording issues not present in the original review.",
          "- If hard errors are fixed and no new hard errors introduced, ACCEPT.",
        );
      } else {
        parts.push("## Review focus");
        parts.push("- Apply the rubric to the writer's draft as in attempt 1.");
      }
      return { outputs: { instruction: parts.join("\n\n") } };
    },
    agentSessionLoadV1: createAgentSessionLoadV1Executor({ store: ss }),
    agentSessionCommitV1: createAgentSessionCommitV1Executor({ store: ss }),
    sessionToMarkdown: async ({ inputs }) => {
      const c = inputs.sessionContext as any;
      return {
        outputs: { markdown: c ? sessionContextToMarkdown(c as any) : "(No session history.)" },
      };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: ws, scopeContext: cx }),
    genericRetriever: genericRetrieverExecutor,
    retrievalResultToMarkdown: retrievalResultToMarkdownExecutor,
    memoryWrite: createMemoryWriteExecutor(ms),
    memoryCorpus: createMemoryCorpusExecutor(ms),
    memoryDelete: createMemoryDeleteExecutor(ms),
  };
  Object.assign(e, createStdlibExecutors());
  // P-11.1: Override jsonSource to auto-increment turnId for idempotent commit in multi-turn tests
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpTurnIdCounter++;
      const turnId = `turn-${String((globalThis as any).__rpTurnIdCounter).padStart(3, "0")}`;
      result.outputs.json = turnId;
    }
    return result;
  };
  return { e, cx, ss, ms, ws };
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
const CUR = JSON.stringify([
  {
    kind: "event",
    summary: "Player gave key",
    entityIds: ["player", "yin_ling"],
    importance: 0.8,
    confidence: 0.9,
  },
]);
async function go(w: WorkflowDefinition, e: Record<string, NodeExecutor>, c: WorkflowRunContext) {
  return runWorkflowWithBranches(w, e, cat(), c);
}

// ---- tests ----
describe("P-11: Validation", () => {
  const pr = createP1ProfileRegistry();
  it("1. 0 errors", () =>
    expect(
      validateWorkflow(wf("rp-unified-stateful-production-v1.json"), cat()).filter(
        (i: any) => i.level === "error",
      ),
    ).toHaveLength(0));
  it("2. P-9 regression", () =>
    expect(
      validateWorkflow(wf("rp-writer-critic-gate-v1.json"), cat()).filter(
        (i: any) => i.level === "error",
      ),
    ).toHaveLength(0));
  it("3. P-10 regression", () =>
    expect(
      validateWorkflow(wf("rp-writer-critic-bounded-revision-v1.json"), cat()).filter(
        (i: any) => i.level === "error",
      ),
    ).toHaveLength(0));
  it("4. P-9 E2E regression", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }]);
    expect((await go(wf("rp-writer-critic-gate-v1.json"), e, cx)).status).toBe("success");
  });
});

describe("P-11: A - First-Pass Accept", () => {
  const pr = createP1ProfileRegistry();
  it("5. W2/C2/G2 skipped", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.status).toBe("success");
    expect(r.nodeRuns.find((n: any) => n.nodeId === "writer2")!.status).toBe("skipped");
    expect(r.nodeRuns.find((n: any) => n.nodeId === "critic2")!.status).toBe("skipped");
    expect(r.nodeRuns.find((n: any) => n.nodeId === "gate2")!.status).toBe("skipped");
  });
  it("6. finalDraft=Draft1", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "selector")!.outputs.finalDraft).toBe(W1);
  });
  it("7. playerOutput=Draft1", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "output")!.outputs.final).toBe(W1);
  });
  it("8. session commit succeeds", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ss });
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.status).toBe("success");
    expect(r.nodeRuns.find((n: any) => n.nodeId === "sessionCommit")!.status).toBe("success");
  });
});

describe("P-11: B - Revision-Pass", () => {
  const pr = createP1ProfileRegistry();
  it("9. writer2 executes", async () => {
    const { e, cx } = mk(pr, [
      { text: W1 },
      { text: CR },
      { text: W2 },
      { text: CA },
      { text: CUR },
    ]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.status).toBe("success");
    expect(r.nodeRuns.find((n: any) => n.nodeId === "writer2")!.status).toBe("success");
  });
  it("10. finalDraft=Draft2", async () => {
    const { e, cx } = mk(pr, [
      { text: W1 },
      { text: CR },
      { text: W2 },
      { text: CA },
      { text: CUR },
    ]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const s = r.nodeRuns.find((n: any) => n.nodeId === "selector")!;
    expect(s.outputs.finalDraft).toBe(W2);
    expect(s.outputs.finalDraft).not.toBe(W1);
  });
  it("11. session commits Draft2", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(
      pr,
      [{ text: W1 }, { text: CR }, { text: W2 }, { text: CA }, { text: CUR }],
      { ss },
    );
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const c = await ss.load({
      tenantId: "default",
      workflowInstanceId: "rp-prod-1",
      conversationId: "session-a",
      agentNodeId: "writer-main",
    });
    expect(c!.turns[0]!.assistantOutput).toBe(W2);
  });
  it("12. playerOutput=Draft2", async () => {
    const { e, cx } = mk(pr, [
      { text: W1 },
      { text: CR },
      { text: W2 },
      { text: CA },
      { text: CUR },
    ]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "output")!.outputs.final).toBe(W2);
  });
});

describe("P-11: C - Exhausted", () => {
  const pr = createP1ProfileRegistry();
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
  it("13. output=Draft2 despite exhaustion", async () => {
    const { e, cx } = mk(pr, [
      { text: W1 },
      { text: CR },
      { text: W2 },
      { text: C2 },
      { text: CUR },
    ]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(r.nodeRuns.find((n: any) => n.nodeId === "output")!.outputs.final).toBe(W2);
  });
  it("14. no 3rd writer", async () => {
    const { e, cx } = mk(pr, [
      { text: W1 },
      { text: CR },
      { text: W2 },
      { text: C2 },
      { text: CUR },
    ]);
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
  });
});

describe("P-11: Multi-Turn", () => {
  const pr = createP1ProfileRegistry();
  const key = {
    tenantId: "default",
    workflowInstanceId: "rp-prod-1",
    conversationId: "session-a",
    agentNodeId: "writer-main",
  };
  it("15. session persists", async () => {
    const ss = new InMemoryAgentSessionStore();
    const f = wf("rp-unified-stateful-production-v1.json");
    const { e: e1, cx: c1 } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ss });
    await go(f, e1, c1);
    expect((await ss.load(key))!.turns.length).toBe(1);
    const { e: e2, cx: c2 } = mk(pr, [{ text: "[R2]" }, { text: CA }, { text: CUR }], { ss });
    await go(f, e2, c2);
    expect((await ss.load(key))!.turns.length).toBe(2);
  });
  it("16. round2 includes session history", async () => {
    const ss = new InMemoryAgentSessionStore();
    const f = wf("rp-unified-stateful-production-v1.json");
    const { e: e1, cx: c1 } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ss });
    await go(f, e1, c1);
    const { e: e2, cx: c2 } = mk(pr, [{ text: "[R2]" }, { text: CA }, { text: CUR }], { ss });
    const r2 = await go(f, e2, c2);
    expect(r2.nodeRuns.find((n: any) => n.nodeId === "sessionMd")!.outputs.markdown).toContain(
      "Session History",
    );
  });
});

describe("P-11: File Persistence", () => {
  const pr = createP1ProfileRegistry();
  const td = resolve(__dirname, "../../../data/test-memories");
  beforeEach(() => {
    if (!existsSync(td)) mkdirSync(td, { recursive: true });
  });
  afterEach(() => {
    try {
      unlinkSync(join(td, "mem.json"));
    } catch {
      /* cleanup */
    }
  });
  it("17. file store cross-instance", async () => {
    const fp = join(td, "mem.json");
    const ss = new InMemoryAgentSessionStore();
    const f = wf("rp-unified-stateful-production-v1.json");
    const { e: e1, cx: c1 } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], {
      ss,
      ms: new FileWorkflowMemoryStore(fp),
    });
    await go(f, e1, c1);
    const s2 = new FileWorkflowMemoryStore(fp);
    const { e: e2, cx: c2 } = mk(pr, [{ text: "[R2]" }, { text: CA }, { text: CUR }], {
      ss,
      ms: s2,
    });
    const r2 = await go(f, e2, c2);
    expect(r2.nodeRuns.find((n: any) => n.nodeId === "memCorpus")!.status).toBe("success");
  });
});

describe("P-11: Isolation", () => {
  const pr = createP1ProfileRegistry();
  it("18. session isolation", async () => {
    const ss = new InMemoryAgentSessionStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ss });
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect(
      await ss.load({
        tenantId: "default",
        workflowInstanceId: "rp-prod-1",
        conversationId: "other",
        agentNodeId: "writer-main",
      }),
    ).toBeNull();
  });
  it("19. memory namespace isolation", async () => {
    const ms = new InMemoryWorkflowMemoryStore();
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }], { ms });
    await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    expect((await ms.list("rp-memory")).length).toBeGreaterThan(0);
    expect((await ms.list("other")).length).toBe(0);
  });
});

describe("P-11: Branch Trace", () => {
  const pr = createP1ProfileRegistry();
  it("20. skipped nodes metadata", async () => {
    const { e, cx } = mk(pr, [{ text: W1 }, { text: CA }, { text: CUR }]);
    const r = await go(wf("rp-unified-stateful-production-v1.json"), e, cx);
    const skipped = r.nodeRuns.filter((n: any) => n.status === "skipped");
    expect(skipped.map((n: any) => n.nodeId)).toEqual(
      expect.arrayContaining(["writer2", "critic2", "gate2"]),
    );
    for (const s of skipped) expect(s.metadata?.skippedReason).toBe("inactive-branch");
  });
  it("21. buildSessionDelta valid", async () => {
    const { e } = mk(pr, []);
    const r = await e.buildSessionDelta!({
      node: { id: "t", type: "buildSessionDelta", position: { x: 0, y: 0 }, config: {} },
      inputs: {
        sessionKey: {
          tenantId: "t",
          workflowInstanceId: "w",
          conversationId: "c",
          agentNodeId: "a",
        },
        playerInput: "hi",
        finalDraft: "hey",
      },
    });
    expect(r.outputs.sessionDelta).toBeDefined();
  });
});
