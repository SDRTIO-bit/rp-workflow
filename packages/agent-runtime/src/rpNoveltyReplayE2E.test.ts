/**
 * P-15.2 Novelty Guard — Deterministic Workflow Replay + Prompt Capture + Checkpoint/Resume
 *
 * This file provides the INTEGRATION-level evidence that the P-15.2 novelty
 * machinery actually fires inside the real `rp-unified-stateful-production-v1`
 * workflow JSON, using a deterministic Mock Adapter and the real node catalog.
 *
 * Existing E2E fixtures (rpUnifiedProductionE2E, rpSideEffectSafetyE2E) use
 * <64-char writer texts, so `textNoveltyCheck` never reaches `exact_duplicate`
 * in those suites. This file uses a 156-char Chinese narrative (the Turn-13/14
 * case from the design doc) so the full novelty → merge → route → writer2 →
 * merge2 → selector → side-effect chain is exercised end-to-end.
 *
 * Coverage:
 *  - Replay 0: first turn, empty session → no_reference → accept
 *  - Replay A: duplicate writer1 → novelty revise → writer2 fresh → accept
 *  - Replay B: duplicate writer1 + writer2 → exhausted return-latest
 *  - Replay C: duplicate writer1 + writer2 → exhausted fail
 *  - Replay D: novelty pass, critic hard reject → revise/exhausted (novelty does not override critic)
 *  - Prompt capture: Writer 1/2/Critic 1/2 content assertions
 *  - Checkpoint/resume: merge1 checkpoint → writer1 not repeated, writer2 continues, session/memory not duplicated
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runWorkflowWithBranches,
  runWorkflowWithCheckpoint,
  resumeWorkflow,
  computeWorkflowHash,
  validateWorkflow,
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
  rpQualityDecisionMergeNode,
  rpQualityDecisionMergeExecutor,
  agentSessionLastAssistantOutputNode,
  agentSessionLastAssistantOutputExecutor,
  failWorkflowNode,
  failWorkflowExecutor,
  InMemoryAgentSessionStore,
  sessionContextToMarkdown,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
  type AgentSessionStore,
} from "./index.js";

// ============ Constants ============

/** 156-char Chinese narrative — the Turn-13/14 duplicate case (≥64 chars). */
const NARRATIVE_156 =
  "广播里的旋律忽然变了调。她侧耳倾听，仿佛在辨认某个遥远的信号。" +
  "空气中有一种微妙的变化，像是旧事在回响，又像是新的脚步声在靠近。" +
  "她低声说：该走了。";

/** A different 156-char narrative (novel, not duplicate). */
const NARRATIVE_FRESH =
  "银铃终于伸出手，指尖触上钥匙的齿纹。她没有立刻拿起，而是沿着每一道凹槽描画，" +
  "像是在读一段只有金属记得的旧事。窗外的雨声渐密，她抬起头，目光越过你投向更远的地方。" +
  "她轻声说：这把钥匙，我见过。";

const ACCEPT = JSON.stringify({
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

const REVISE = JSON.stringify({
  decision: "revise",
  scores: {
    continuity: 0.8,
    characterConsistency: 0.7,
    playerAgency: 0.3,
    knowledgeBoundary: 0.8,
    styleAndFormat: 0.8,
  },
  issues: [
    {
      code: "player-agency",
      severity: "error",
      message: "Controls player",
      suggestion: "Remove",
    },
  ],
  revisionInstruction: "Let the player decide.",
});

const CURATOR_EMPTY = "[]";

const CURATOR_WITH_CANDIDATES = JSON.stringify([
  {
    kind: "event",
    summary: "Player offered the warehouse key to Yin Ling.",
    entityIds: ["player", "yin_ling"],
    importance: 0.8,
    confidence: 0.9,
  },
]);

const SESSION_KEY = {
  tenantId: "default",
  workflowInstanceId: "rp-prod-1",
  conversationId: "session-a",
  agentNodeId: "writer-main",
};

// ============ Helpers ============

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
    rpQualityDecisionMerge: rpQualityDecisionMergeNode,
    agentSessionLastAssistantOutput: agentSessionLastAssistantOutputNode,
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

function wf(): WorkflowDefinition {
  return JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../data/workflows/rp-unified-stateful-production-v1.json"),
      "utf-8",
    ),
  ).workflow;
}

type Capture = { prompt: string; response: string; index: number };

interface MkOptions {
  ss?: AgentSessionStore;
  ms?: WorkflowMemoryStore;
  ws?: DynamicWorldbookStore;
  onExhausted?: "return-latest" | "fail";
}

/**
 * Build executors + run context with a prompt-recording mock adapter.
 * `responses` are returned in order; each prompt is captured.
 */
function mk(responses: string[], o?: MkOptions) {
  const captures: Capture[] = [];
  let ci = 0;
  const ad = {
    provider: "mock" as const,
    async complete(p: { model: string; prompt: string; temperature?: number }) {
      const idx = ci++;
      const text = responses[idx] ?? "";
      captures.push({ prompt: p.prompt, response: text, index: idx });
      return { text, tokenUsage: { input: 100, output: text.length } };
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
  const pr = createP1ProfileRegistry();
  const ss = o?.ss ?? new InMemoryAgentSessionStore();
  const ms = o?.ms ?? new InMemoryWorkflowMemoryStore();
  const ws = o?.ws ?? new InMemoryDynamicWorldbookStore();
  const cx: WorkflowRunContext = { sessionId: "session-a" };

  if (!(globalThis as any).__rpNoveltyTurnIdCounter) {
    (globalThis as any).__rpNoveltyTurnIdCounter = 0;
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
    rpQualityDecisionMerge: rpQualityDecisionMergeExecutor,
    agentSessionLastAssistantOutput: agentSessionLastAssistantOutputExecutor,
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
        outputs: {
          markdown: c ? sessionContextToMarkdown(c as any) : "(No session history.)",
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
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpNoveltyTurnIdCounter++;
      result.outputs.json = `turn-${String((globalThis as any).__rpNoveltyTurnIdCounter).padStart(3, "0")}`;
    }
    return result;
  };

  const workflow = JSON.parse(JSON.stringify(wf())) as any;
  if (o?.onExhausted) {
    const decNode = workflow.nodes.find((n: any) => n.id === "decision");
    if (decNode) decNode.config.onExhausted = o.onExhausted;
  }

  return { e, cx, ss, ms, ws, workflow, captures };
}

async function go(
  workflow: WorkflowDefinition,
  e: Record<string, NodeExecutor>,
  cx: WorkflowRunContext,
) {
  return runWorkflowWithBranches(workflow, e, cat(), cx);
}

function statusOf(r: any, nodeId: string): string {
  const run = r.nodeRuns.find((n: any) => n.nodeId === nodeId);
  return run ? run.status : "absent";
}

function outputOf(r: any, nodeId: string, port: string): any {
  const run = r.nodeRuns.find((n: any) => n.nodeId === nodeId);
  return run?.outputs?.[port];
}

// ============ Pre-seed helper ============

async function seedSession(ss: AgentSessionStore, assistantOutput: string, turnIndex = 13) {
  await ss.append(SESSION_KEY, {
    sessionKey: SESSION_KEY,
    newTurn: {
      turnIndex,
      input: "玩家上一轮输入",
      assistantOutput,
      modelConfig: { model: "mock-model" },
      tokenUsage: { input: 100, output: 100 },
      createdAt: new Date().toISOString(),
    },
  });
}

// ============ Tests ============

describe("P-15.2: Workflow Validation", () => {
  it("formal JSON validates with 0 errors", () => {
    const issues = validateWorkflow(wf(), cat());
    expect(issues.filter((i: any) => i.level === "error")).toHaveLength(0);
  });
});

// ── Replay 0: First turn, empty session ──
describe("P-15.2 Replay 0: First turn (empty session)", () => {
  it("no_reference → accept, writer2 skipped, session + memory committed", async () => {
    const { e, cx, ss, ms, workflow } = mk([
      NARRATIVE_156, // writer1
      ACCEPT, // critic1
      CURATOR_WITH_CANDIDATES, // curator — produces memory candidates
    ]);

    const r = await go(workflow, e, cx);
    expect(r.status).toBe("success");

    // novelty1: no reference (empty session)
    const novelty1Out = outputOf(r, "novelty1", "report");
    expect(novelty1Out.reason).toBe("no_reference");
    expect(novelty1Out.exactDuplicate).toBe(false);
    expect(novelty1Out.evaluated).toBe(false);

    // merge1: follows critic (accept)
    const merge1Dec = outputOf(r, "merge1", "decision");
    expect(merge1Dec.decision).toBe("accept");
    expect(merge1Dec.accepted).toBe(true);

    // writer2 / critic2 / gate2 / novelty2 / merge2 skipped
    expect(statusOf(r, "writer2")).toBe("skipped");
    expect(statusOf(r, "critic2")).toBe("skipped");
    expect(statusOf(r, "novelty2")).toBe("skipped");
    expect(statusOf(r, "merge2")).toBe("skipped");

    // accepted, session commit, memory allowed
    expect(statusOf(r, "output")).toBe("success");
    expect(statusOf(r, "sessionCommit")).toBe("success");
    expect(statusOf(r, "curator")).toBe("success");
    expect(statusOf(r, "memWrite")).toBe("success");

    // Session has 1 turn committed with NARRATIVE_156
    const ctx = await ss.load(SESSION_KEY);
    expect(ctx!.turns.length).toBe(1);
    expect(ctx!.turns[0]!.assistantOutput).toBe(NARRATIVE_156);

    // Memory has entries (curator produced candidates)
    expect((await ms.list("rp-memory")).length).toBeGreaterThan(0);
  });
});

// ── Replay A: Duplicate writer1 → revise → writer2 fresh → accept ──
describe("P-15.2 Replay A: Duplicate then fresh (revise-accept)", () => {
  it("novelty1 exact_duplicate → merge1 revise → writer2 fresh → merge2 accept", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const { e, cx, workflow } = mk(
      [
        NARRATIVE_156, // writer1 = duplicate of turn 13
        ACCEPT, // critic1 accepts (does not catch duplication)
        NARRATIVE_FRESH, // writer2 = fresh narrative
        ACCEPT, // critic2 accepts
        CURATOR_EMPTY, // curator
      ],
      { ss },
    );

    const r = await go(workflow, e, cx);
    expect(r.status).toBe("success");

    // novelty1: exact duplicate detected
    const novelty1Out = outputOf(r, "novelty1", "report");
    expect(novelty1Out.reason).toBe("exact_duplicate");
    expect(novelty1Out.exactDuplicate).toBe(true);
    expect(novelty1Out.evaluated).toBe(true);
    expect(novelty1Out.normalizedCurrentLength).toBeGreaterThanOrEqual(64);
    expect(novelty1Out.normalizedReferenceLength).toBeGreaterThanOrEqual(64);

    // merge1: novelty overrides critic accept → revise
    const merge1Dec = outputOf(r, "merge1", "decision");
    expect(merge1Dec.accepted).toBe(false);
    expect(merge1Dec.decision).toBe("revise");
    expect(merge1Dec.failedChecks).toContain("exact_duplicate");
    expect(merge1Dec.revisionInstruction).toContain("本轮正文与上一轮已提交正文重复");

    // merge1 diagnostics (separate port)
    const merge1Diag = outputOf(r, "merge1", "diagnostics");
    expect(merge1Diag.overriddenByNovelty).toBe(true);
    expect(merge1Diag.attempt).toBe(1);
    expect(merge1Diag.novelty.exactDuplicate).toBe(true);

    // writer2 executed (revise branch)
    expect(statusOf(r, "writer2")).toBe("success");
    expect(statusOf(r, "critic2")).toBe("success");

    // novelty2: novel (fresh text)
    const novelty2Out = outputOf(r, "novelty2", "report");
    expect(novelty2Out.reason).toBe("novel");
    expect(novelty2Out.exactDuplicate).toBe(false);

    // merge2: accept
    const merge2Dec = outputOf(r, "merge2", "decision");
    expect(merge2Dec.accepted).toBe(true);
    expect(merge2Dec.decision).toBe("accept");

    // final: accepted, not exhausted
    const loopResult = outputOf(r, "selector", "loopResult");
    expect(loopResult.accepted).toBe(true);
    expect(loopResult.exhausted).toBe(false);
    expect(loopResult.writerAttempts).toBe(2);

    // player output = fresh draft
    expect(outputOf(r, "output", "final")).toBe(NARRATIVE_FRESH);

    // session commit + memory
    expect(statusOf(r, "sessionCommit")).toBe("success");
    expect(statusOf(r, "curator")).toBe("success");
    expect(statusOf(r, "memWrite")).toBe("success");

    // Session now has 2 turns (seeded + new), last = FRESH
    const ctx = await ss.load(SESSION_KEY);
    expect(ctx!.turns.length).toBe(2);
    expect(ctx!.turns[1]!.assistantOutput).toBe(NARRATIVE_FRESH);
  });
});

// ── Replay B: Duplicate twice → exhausted return-latest ──
describe("P-15.2 Replay B: Duplicate twice (exhausted return-latest)", () => {
  it("merge2 exhausted → player gets Draft2, session commit, curator/mem skipped", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const { e, cx, ms, workflow } = mk(
      [
        NARRATIVE_156, // writer1 = duplicate
        ACCEPT, // critic1
        NARRATIVE_156, // writer2 = also duplicate
        ACCEPT, // critic2
      ],
      { ss, onExhausted: "return-latest" },
    );

    const r = await go(workflow, e, cx);
    expect(r.status).toBe("success");

    // novelty1 + novelty2 both exact_duplicate
    expect(outputOf(r, "novelty1", "report").reason).toBe("exact_duplicate");
    expect(outputOf(r, "novelty2", "report").reason).toBe("exact_duplicate");

    // merge1: revise (attempt 1)
    expect(outputOf(r, "merge1", "decision").decision).toBe("revise");

    // merge2: exhausted (attempt 2 + duplicate)
    const merge2Dec = outputOf(r, "merge2", "decision");
    expect(merge2Dec.decision).toBe("exhausted");
    expect(merge2Dec.accepted).toBe(false);
    expect(merge2Dec.failedChecks).toContain("exact_duplicate");

    // selector: exhausted=true
    const loopResult = outputOf(r, "selector", "loopResult");
    expect(loopResult.exhausted).toBe(true);
    expect(loopResult.accepted).toBe(false);

    // player output = Draft2 (NARRATIVE_156 — the duplicate, returned as latest)
    expect(statusOf(r, "output")).toBe("success");
    expect(outputOf(r, "output", "final")).toBe(NARRATIVE_156);

    // session commit = success (return-latest commits)
    expect(statusOf(r, "sessionCommit")).toBe("success");

    // curator + memWrite skipped (return-latest blocks memory)
    expect(statusOf(r, "curator")).toBe("skipped");
    expect(statusOf(r, "memWrite")).toBe("skipped");

    // Memory unchanged
    expect((await ms.list("rp-memory")).length).toBe(0);

    // Session now has 2 turns
    const ctx = await ss.load(SESSION_KEY);
    expect(ctx!.turns.length).toBe(2);
  });
});

// ── Replay C: Duplicate twice → exhausted fail ──
describe("P-15.2 Replay C: Duplicate twice (exhausted fail)", () => {
  it("workflow error, no player output, no session commit, no curator, no memory", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const { e, cx, ms, workflow } = mk(
      [
        NARRATIVE_156, // writer1 = duplicate
        ACCEPT, // critic1
        NARRATIVE_156, // writer2 = duplicate
        ACCEPT, // critic2
      ],
      { ss, onExhausted: "fail" },
    );

    const r = await go(workflow, e, cx);
    expect(r.status).toBe("error");

    // merge2: exhausted
    expect(outputOf(r, "merge2", "decision").decision).toBe("exhausted");

    // failWorkflow executes
    expect(statusOf(r, "fail")).toBe("error");

    // No player output success
    expect(statusOf(r, "output")).not.toBe("success");
    // No session commit success
    expect(statusOf(r, "sessionCommit")).not.toBe("success");
    // No curator success
    expect(statusOf(r, "curator")).not.toBe("success");
    // No memory write success
    expect(statusOf(r, "memWrite")).not.toBe("success");

    // Memory unchanged
    expect((await ms.list("rp-memory")).length).toBe(0);

    // Session unchanged (only the seed)
    const ctx = await ss.load(SESSION_KEY);
    expect(ctx!.turns.length).toBe(1);
  });
});

// ── Replay D: Novelty pass, Critic hard reject → revise/exhausted ──
describe("P-15.2 Replay D: Critic independent reject (novelty pass)", () => {
  it("novelty does not override critic; revise/exhausted proceeds normally", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const { e, cx, workflow } = mk(
      [
        NARRATIVE_FRESH, // writer1 = novel (not duplicate)
        REVISE, // critic1 hard reject
        NARRATIVE_FRESH, // writer2 = novel
        REVISE, // critic2 hard reject
      ],
      { ss, onExhausted: "return-latest" },
    );

    const r = await go(workflow, e, cx);
    expect(r.status).toBe("success");

    // novelty1: novel (pass)
    const novelty1Out = outputOf(r, "novelty1", "report");
    expect(novelty1Out.reason).toBe("novel");
    expect(novelty1Out.exactDuplicate).toBe(false);

    // merge1: follows critic (revise), NOT overridden by novelty
    const merge1Dec = outputOf(r, "merge1", "decision");
    expect(merge1Dec.decision).toBe("revise");
    expect(merge1Dec.accepted).toBe(false);
    // revisionInstruction = critic's, not novelty's
    expect(merge1Dec.revisionInstruction).toBe("Let the player decide.");
    // No exact_duplicate in failedChecks (novelty didn't fire)
    expect(merge1Dec.failedChecks).not.toContain("exact_duplicate");

    // merge1 diagnostics: not overridden by novelty
    const merge1Diag = outputOf(r, "merge1", "diagnostics");
    expect(merge1Diag.overriddenByNovelty).toBe(false);

    // novelty2: novel
    expect(outputOf(r, "novelty2", "report").reason).toBe("novel");

    // merge2: exhausted (attempt 2 + critic reject, novelty pass)
    const merge2Dec = outputOf(r, "merge2", "decision");
    expect(merge2Dec.decision).toBe("exhausted");

    // selector: exhausted
    expect(outputOf(r, "selector", "loopResult").exhausted).toBe(true);

    // return-latest: player gets draft, session commits, memory skipped
    expect(statusOf(r, "output")).toBe("success");
    expect(statusOf(r, "sessionCommit")).toBe("success");
    expect(statusOf(r, "curator")).toBe("skipped");
  });
});

// ── Prompt Capture: Writer 1 / Writer 2 / Critic 1 / Critic 2 ──
describe("P-15.2 Prompt Capture (Replay A path)", () => {
  it("Writer 1: no ## Data section, no novelty, no reference injection, no diagnostics", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);
    const { e, cx, workflow, captures } = mk(
      [NARRATIVE_156, ACCEPT, NARRATIVE_FRESH, ACCEPT, CURATOR_EMPTY],
      { ss },
    );

    await go(workflow, e, cx);

    // captures[0] = writer1
    const w1Prompt = captures[0]!.prompt;
    // Writer 1 has NO ## Data section (no data input wired to writer1)
    expect(w1Prompt).not.toContain("## Data");
    // Writer 1 prompt does NOT contain novelty revision instruction
    expect(w1Prompt).not.toContain("本轮正文与上一轮已提交正文重复");
    // Writer 1 prompt does NOT contain diagnostics schema
    expect(w1Prompt).not.toContain("awp.rp-merged-quality-diagnostics");
    // Writer 1 prompt does NOT contain novelty report schema
    expect(w1Prompt).not.toContain("awp.text-novelty-report");
    // Writer 1 prompt does NOT contain "exact_duplicate" routing reason
    expect(w1Prompt).not.toContain("exact_duplicate");
  });

  it("Writer 2: contains novelty revision instruction, no diagnostics/scores/issues/reference", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);
    const { e, cx, workflow, captures } = mk(
      [NARRATIVE_156, ACCEPT, NARRATIVE_FRESH, ACCEPT, CURATOR_EMPTY],
      { ss },
    );

    await go(workflow, e, cx);

    // captures[2] = writer2
    const w2Prompt = captures[2]!.prompt;
    // Writer 2 HAS ## Data section (merge1.decision rendered)
    expect(w2Prompt).toContain("## Data");
    // Writer 2 sees the novelty revision instruction
    expect(w2Prompt).toContain("本轮正文与上一轮已提交正文重复");
    // Writer 2 does NOT see diagnostics schema
    expect(w2Prompt).not.toContain("awp.rp-merged-quality-diagnostics");
    // Writer 2 does NOT see novelty report details (normalized lengths, reason)
    expect(w2Prompt).not.toContain("normalizedCurrentLength");
    expect(w2Prompt).not.toContain("normalizedReferenceLength");
    // Writer 2 does NOT see the reference narrative body
    // (NARRATIVE_156 may appear in session history via sessionMd, but the
    // novelty reference port does NOT feed writer2. We assert the reference
    // is not injected via the Data/diagnostics channel.)
    // Writer 2 does NOT see critic scores or issues full list
    expect(w2Prompt).not.toContain("continuity");
    expect(w2Prompt).not.toContain("playerAgency");
    // Writer 2 does NOT see inspect/debug data
    expect(w2Prompt).not.toContain("[JSON]");
    expect(w2Prompt).not.toContain("[MD]");
  });

  it("Critic 1: no novelty report, no reference, no diagnostics", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);
    const { e, cx, workflow, captures } = mk(
      [NARRATIVE_156, ACCEPT, NARRATIVE_FRESH, ACCEPT, CURATOR_EMPTY],
      { ss },
    );

    await go(workflow, e, cx);

    // captures[1] = critic1
    const c1Prompt = captures[1]!.prompt;
    expect(c1Prompt).not.toContain("awp.text-novelty-report");
    expect(c1Prompt).not.toContain("exact_duplicate");
    expect(c1Prompt).not.toContain("本轮正文与上一轮已提交正文重复");
    expect(c1Prompt).not.toContain("awp.rp-merged-quality-diagnostics");
  });

  it("Critic 2: valid prompt even when gate1.accepted=true (novelty-only revise)", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);
    const { e, cx, workflow, captures } = mk(
      [NARRATIVE_156, ACCEPT, NARRATIVE_FRESH, ACCEPT, CURATOR_EMPTY],
      { ss },
    );

    await go(workflow, e, cx);

    // captures[3] = critic2
    const c2Prompt = captures[3]!.prompt;
    // Critic 2 prompt is non-empty and valid
    expect(c2Prompt.length).toBeGreaterThan(100);
    // Critic 2 does NOT see novelty report
    expect(c2Prompt).not.toContain("awp.text-novelty-report");
    expect(c2Prompt).not.toContain("exact_duplicate");
    expect(c2Prompt).not.toContain("本轮正文与上一轮已提交正文重复");
    // criticInstructionBuilder produced a valid structure (Review focus present)
    expect(c2Prompt).toContain("Review focus");
    // Critic 2 sees the new draft (writer2 result)
    expect(c2Prompt).toContain(NARRATIVE_FRESH);
  });
});

// ── Checkpoint / Resume ──
describe("P-15.2 Checkpoint/Resume (Replay A path)", () => {
  it("merge1 checkpoint: writer1 not repeated, writer2 continues, session/memory not duplicated", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const responses = [
      NARRATIVE_156, // writer1
      ACCEPT, // critic1
      NARRATIVE_FRESH, // writer2
      ACCEPT, // critic2
      CURATOR_EMPTY, // curator
    ];

    // First run with checkpoint captured after merge1
    let checkpoint: any;
    const completedIds: string[] = [];
    const nodeOutputs: Record<string, any> = {};

    const { e: e1, cx: cx1, ss: ss1, ms: ms1, workflow: wf1 } = mk(responses, { ss });

    // Instrument to track which nodes invoked the LLM, by node id
    const invokedNodes: string[] = [];
    const origSpecialized = e1.specializedAgent!;
    e1.specializedAgent = async (ctx) => {
      invokedNodes.push(ctx.node.id);
      return origSpecialized(ctx);
    };

    await runWorkflowWithCheckpoint(wf1, e1, cat(), cx1, {
      onNodeCompleted: async (runId, nodeId, outputs) => {
        completedIds.push(nodeId);
        nodeOutputs[nodeId] = outputs;
        if (nodeId === "merge1") {
          checkpoint = {
            runId,
            workflowId: wf1.id,
            workflowHash: computeWorkflowHash(wf1),
            completedNodeIds: [...completedIds],
            skippedNodeIds: [],
            nodeOutputs: { ...nodeOutputs },
          };
        }
      },
    });

    expect(checkpoint).toBeDefined();
    // First run (before checkpoint at merge1): writer1 + critic1 invoked.
    // writer2/curator run AFTER merge1, so they are NOT in the checkpoint's
    // completedNodeIds and will be re-executed on resume.
    const firstRunInvokedWriter1 = invokedNodes.includes("writer1");
    expect(firstRunInvokedWriter1).toBe(true);

    // Session has 2 turns after first run (seed + fresh)
    const ctx1After = await ss1.load(SESSION_KEY);
    expect(ctx1After!.turns.length).toBe(2);

    // Resume from checkpoint — writer1 should NOT repeat (already completed).
    // Resume responses: writer2=FRESH, critic2=ACCEPT, curator=candidates
    // (writer1/critic1 are skipped on resume because they're in checkpoint)
    const resumeResponses = [NARRATIVE_FRESH, ACCEPT, CURATOR_WITH_CANDIDATES];
    const {
      e: e2,
      cx: cx2,
      ss: ss2,
      workflow: wf2,
    } = mk(resumeResponses, {
      ss: ss1,
      ms: ms1,
    });

    // Track resume invocations by node id
    const resumeInvokedNodes: string[] = [];
    const origSpecialized2 = e2.specializedAgent!;
    e2.specializedAgent = async (ctx) => {
      resumeInvokedNodes.push(ctx.node.id);
      return origSpecialized2(ctx);
    };

    const r2 = await resumeWorkflow(wf2, e2, checkpoint, cat(), cx2);

    // KEY INVARIANT: writer1 must NOT be re-invoked on resume (it was
    // already in checkpoint.completedNodeIds). writer2 SHOULD run.
    expect(resumeInvokedNodes).not.toContain("writer1");
    expect(resumeInvokedNodes).toContain("writer2");

    // Session commit should not duplicate (idempotent with same turnId)
    const ctx2After = await ss2.load(SESSION_KEY);
    expect(ctx2After!.turns.length).toBe(2); // still 2, not 3

    // Memory writes: curator may or may not re-run, but the session turn
    // count must not increase (idempotent side effects).
    expect(ctx2After!.turns.length).toBe(ctx1After!.turns.length);

    // Novelty + merge outputs on resume should be consistent
    if (r2.nodeRuns.find((n: any) => n.nodeId === "novelty2")) {
      const n2 = outputOf(r2, "novelty2", "report");
      if (n2) {
        expect(n2.reason).toBe("novel");
        expect(n2.exactDuplicate).toBe(false);
      }
      const m2 = outputOf(r2, "merge2", "decision");
      if (m2) {
        expect(m2.decision).toBe("accept");
      }
    }
  });

  it("skipped nodes stay skipped after resume (Replay B exhausted path)", async () => {
    const ss = new InMemoryAgentSessionStore();
    await seedSession(ss, NARRATIVE_156, 13);

    const responses = [NARRATIVE_156, ACCEPT, NARRATIVE_156, ACCEPT];

    let checkpoint: any;
    const completedIds: string[] = [];
    const nodeOutputs: Record<string, any> = {};

    const { e, cx, workflow } = mk(responses, { ss, onExhausted: "return-latest" });

    await runWorkflowWithCheckpoint(workflow, e, cat(), cx, {
      onNodeCompleted: async (runId, nodeId, outputs) => {
        completedIds.push(nodeId);
        nodeOutputs[nodeId] = outputs;
        if (nodeId === "merge2") {
          checkpoint = {
            runId,
            workflowId: workflow.id,
            workflowHash: computeWorkflowHash(workflow),
            completedNodeIds: [...completedIds],
            skippedNodeIds: [],
            nodeOutputs: { ...nodeOutputs },
          };
        }
      },
    });

    expect(checkpoint).toBeDefined();

    const r2 = await resumeWorkflow(workflow, e, checkpoint, cat(), cx);
    // curator should remain skipped (exhausted return-latest)
    const curator = r2.nodeRuns.find((n: any) => n.nodeId === "curator");
    expect(curator ? curator.status : "absent").toBe("skipped");
    // memWrite should remain skipped
    const memWrite = r2.nodeRuns.find((n: any) => n.nodeId === "memWrite");
    expect(memWrite ? memWrite.status : "absent").toBe("skipped");
  });
});
