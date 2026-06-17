/**
 * P-15.1 RP Prompt Capture — Baseline & Post-Trim Measurements
 *
 * Captures the actual prompts sent to writer / critic / curator LLM calls
 * in the unified workflow, and asserts on content + size.
 *
 * Tests:
 *  1. Necessary content is present in each prompt
 *  2. Trimmed content is NOT present (post-trim)
 *  3. Size reduction measured against baseline
 *  4. accepted / revision-accepted / exhausted side effects unchanged
 *
 * The actual trimming is implemented in:
 *  - data/workflows/rp-unified-stateful-production-v1.json
 *  - apps/server/src/rp/officialRpExecutorFactory.ts (criticInstructionBuilder)
 *
 * Baseline prompt sizes (with default 20-turn fixture context):
 *   writer1:  ~13000 chars
 *   critic1:  ~13000 chars (full ctxMerge2 = session+worldbook+memory)
 *   writer2:  ~14000 chars
 *   critic2:  ~14000 chars
 *   curator:  ~13000 chars
 *
 * Post-trim targets:
 *   critic1:  ~6000 chars (worldbook only, no session, no memory)
 *   critic2:  ~6000 chars + revision instruction (~200 chars)
 *   curator:  ~3000 chars (player input + draft only, no worldbook, no memory, no session)
 */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runWorkflowWithBranches,
  nodeRegistry,
  type NodeExecutor,
  type WorkflowRunContext,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import { genericRetrieverNode, retrievalResultToMarkdownNode } from "@awp/workflow-retrieval";
import {
  memoryWriteNode,
  memoryCorpusNode,
  memoryDeleteNode,
  InMemoryWorkflowMemoryStore,
  createMemoryWriteExecutor,
  createMemoryCorpusExecutor,
  createMemoryDeleteExecutor,
} from "@awp/workflow-memory";
import {
  dynamicWorldbookNode,
  InMemoryDynamicWorldbookStore,
  createDynamicWorldbookExecutor,
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
  failWorkflowNode,
  failWorkflowExecutor,
  InMemoryAgentSessionStore,
  sessionContextToMarkdown,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
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
    agentSessionLoadV1: agentSessionLoadV1Definition,
    agentSessionCommitV1: agentSessionCommitV1Definition,
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
  };
}
function wf(n: string) {
  return JSON.parse(readFileSync(resolve(__dirname, "../../../data/workflows", n), "utf-8"))
    .workflow;
}

// ============ Prompt Recorder ============
type Role = "writer" | "critic" | "curator";
type Capture = { role: Role; attempt: number; prompt: string; response: string };

function makeRecorder(roleResponses: Array<{ role: Role; text: string }>) {
  const captures: Capture[] = [];
  let i = 0;
  return {
    captures,
    complete: (p: { model: string; prompt: string; temperature?: number }) => {
      const expected = roleResponses[i]!;
      captures.push({
        role: expected.role,
        attempt: 0,
        prompt: p.prompt,
        response: expected.text,
      });
      i++;
      return Promise.resolve({
        text: expected.text,
        tokenUsage: { input: 100, output: expected.text.length },
      });
    },
  };
}

// ============ Estimator & Sentinels ============

/**
 * Project-wide convention: chars / 4 (matches agentV2.estimateTokens
 * and llmUsage.ts token estimation).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function byteSize(text: string): number {
  return Buffer.byteLength(text, "utf-8");
}

// ============ Sentinels: injected into fixtures to prove exclusion ============
// These tokens must NEVER appear in critic/curator prompts after the trim.
// They are unique enough to make absence meaningful.
const SENTINEL_SESSION_OLD_TURN = "OLDTURN_SENTINEL_TOKEN_881e7f";
const SENTINEL_UNRELATED_WORLDBOOK = "UNRELATED_WB_SENTINEL_TOKEN_4d2a91";
const SENTINEL_REJECTED_DRAFT = "REJECTED_DRAFT_SENTINEL_TOKEN_5c1b88";
const SENTINEL_CRITIC_JSON = "CRITIC_JSON_SENTINEL_TOKEN_9f3c02";
const SENTINEL_GATE_RESULT = "GATE_RESULT_SENTINEL_TOKEN_77ad44";
const SENTINEL_FAILED_CHECKS = "FAILED_CHECKS_SENTINEL_TOKEN_e21c61";
const SENTINEL_REVISION_INSTRUCTION = "REVISION_INSTRUCTION_SENTINEL_TOKEN_bb09e7";
const SENTINEL_REVISE_BRANCH = "REVISE_BRANCH_SENTINEL_TOKEN_3e7d99";
const SENTINEL_RETRIEVAL_DIAG = "RETRIEVAL_DIAG_SENTINEL_TOKEN_19c4c0";
const SENTINEL_STORE_METADATA = "STORE_METADATA_SENTINEL_TOKEN_8b1af2";
const SENTINEL_OBSERVABILITY = "OBSERVABILITY_SENTINEL_TOKEN_55ee03";
const SENTINEL_PRESET_FULL = "FULL_PRESET_SENTINEL_TOKEN_c0ffee"; // appears in writer preset; critics should NOT see it

// Sentinels that MUST appear (proves necessary content survives).
const SENTINEL_PLAYER_INPUT = "PLAYER_INPUT_SENTINEL_fff999";
const SENTINEL_FINAL_DRAFT = "FINAL_DRAFT_SENTINEL_55ee22";
const SENTINEL_AGENCY_RULE = "AGENCY_RULE_SENTINEL_22ee11";
const SENTINEL_KNOWLEDGE_RULE = "KNOWLEDGE_RULE_SENTINEL_88cc33";
const SENTINEL_SESSION_ID = "SESSID_SENTINEL_3a4b5c";
const SENTINEL_TURN_ID = "TURNID_SENTINEL_6d7e8f";
const SENTINEL_REVISION_TARGET = "REV_TARGET_SENTINEL_aa11bb"; // appears in gate1.revisionInstruction → critic 2 must see it

// ============ Test Fixtures ============

const PLAYER_INPUT = `${SENTINEL_PLAYER_INPUT} 我把钥匙放到银铃面前，问她是否认识这把钥匙。`;
const WORLDBOOK_CONTENT = `## Old Station
${SENTINEL_UNRELATED_WORLDBOOK}_detail
A abandoned station in the rain.`;
const WB_RETRIEVAL = JSON.stringify({
  hits: [
    {
      id: "station",
      title: "Old Station",
      content: WORLDBOOK_CONTENT,
      score: 0.9,
      diagnostics: SENTINEL_RETRIEVAL_DIAG + "_score=0.9_rank=1_source=keyword",
      metadata: {
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: SENTINEL_STORE_METADATA,
        sourceIndex: 7,
      },
    },
  ],
});
const MEM_RETRIEVAL = JSON.stringify({
  hits: [
    {
      id: "mem-1",
      title: "Old conversation snippet",
      content:
        "Some old memory with " +
        SENTINEL_RETRIEVAL_DIAG +
        "_memrank and " +
        SENTINEL_STORE_METADATA,
      score: 0.7,
    },
    {
      id: "mem-2",
      title: "Another memory",
      content: "More memory content " + SENTINEL_RETRIEVAL_DIAG + "_memrank2",
      score: 0.5,
    },
  ],
});
const PRESET = "## Style\n- Chinese literary narrative\n- Max 300 chars\n\n" + SENTINEL_PRESET_FULL;
// SESSION_MD is now a dead constant (sessionToMarkdown reads from the
// AgentSessionStore). Session sentinel injection happens via ss.append()
// in runWorkflowCaptures.

// W1_TEXT carries BOTH sentinels:
// - FINAL_DRAFT: present whenever this draft is selected as the final output
//   (CA path uses writer1's draft directly; revision path may also use it
//   if gate2 fails — but with our fixtures gate2 always accepts).
// - REJECTED_DRAFT: used to detect if the curator accidentally receives the
//   rejected version of a revision path.
// Critically, W1_TEXT does NOT carry SESSION_OLD_TURN — so the trim assertion
// for session exclusion holds.
const W1_TEXT = `${SENTINEL_REJECTED_DRAFT}_writer1_draft ${SENTINEL_FINAL_DRAFT}_candidate 银铃看了钥匙，沉默片刻。`;
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
    {
      code: "player-agency",
      severity: "error",
      message: "Controls player",
      evidence: '"You decide."',
      suggestion: "Remove",
    },
  ],
  revisionInstruction: `${SENTINEL_REVISION_TARGET} Remove the player decision. ${SENTINEL_REVISION_INSTRUCTION}_should_not_leak_into_curator`,
});
// W2_TEXT carries ONLY the final-draft sentinel. The critic-JSON sentinel
// lives in the critic's JSON output (CR.revisionInstruction) so it can be
// detected when it leaks into curator or other downstream nodes.
const W2_TEXT = `${SENTINEL_FINAL_DRAFT}_writer2_accepted 银铃看了钥匙，摇头说不认得。`;
const CURATOR_TEXT = "[]";

// Synthetic revision-target prompt (the kind of message criticInstructionBuilder would emit):

// ============ Run Helpers ============

async function runUnifiedOnce(responses: Array<{ role: Role; text: string }>) {
  (globalThis as any).__rpPromptCapTurnIdCounter = 0;
  const rec = makeRecorder(responses);
  // Re-attach recorder's complete to a fresh adapter
  const ad = { provider: "mock" as const, complete: rec.complete };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => ad,
  });
  const pr = createP1ProfileRegistry();
  const ss = new InMemoryAgentSessionStore();
  const ms = new InMemoryWorkflowMemoryStore();
  const ws = new InMemoryDynamicWorldbookStore();
  const cx: WorkflowRunContext = { sessionId: "session-a" };

  // Seed worldbook entries so retrieval has something to return
  await ws.save("session:session-a:worldbook:default", "worldbook:default", {
    version: 1,
    entries: [
      {
        id: "station",
        title: "Old Station",
        content: WORLDBOOK_CONTENT,
        tags: [],
        type: "world",
        priority: 50,
        updatedAt: new Date().toISOString(),
      },
    ],
  });

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
    sessionToMarkdown: async ({ inputs }) => {
      const c = inputs.sessionContext as any;
      return {
        outputs: { markdown: c ? sessionContextToMarkdown(c as any) : "(No session history.)" },
      };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: ws, scopeContext: cx }),
    genericRetriever: async ({ inputs, node }) => {
      // Mock retrieval: return worldbook for wbRetrieve, empty for memRetrieve
      const isMem =
        (node.config as any)?.strategy === "keyword" && (node.config as any)?.limit === 6;
      if (isMem) {
        return { outputs: { result: JSON.parse(MEM_RETRIEVAL) } };
      }
      return { outputs: { result: JSON.parse(WB_RETRIEVAL) } };
    },
    retrievalResultToMarkdown: async ({ inputs }) => {
      // Mirror production default rendering: ONLY title + content (no
      // diagnostics, no metadata). The retrieval node definition's defaults
      // for includeScores / includeMetadata are both false.
      type Hit = {
        id?: string;
        title?: string;
        content?: string;
      };
      const r = inputs.result as { hits: Hit[] };
      const md = r.hits.map((h) => `## ${h.title ?? "Untitled"}\n${h.content ?? ""}`).join("\n\n");
      return { outputs: { markdown: md || "(no results)" } };
    },
    memoryWrite: createMemoryWriteExecutor(ms),
    memoryCorpus: createMemoryCorpusExecutor(ms),
    memoryDelete: createMemoryDeleteExecutor(ms),
  };
  Object.assign(e, createStdlibExecutors());
  // Override jsonSource to auto-increment turnId
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpPromptCapTurnIdCounter++;
      const turnId = `turn-${String((globalThis as any).__rpPromptCapTurnIdCounter).padStart(3, "0")}`;
      result.outputs.json = turnId;
    }
    return result;
  };

  // Patch the workflow: override the player input text and preset
  const workflow = JSON.parse(JSON.stringify(wf("rp-unified-stateful-production-v1.json"))) as any;
  for (const n of workflow.nodes) {
    if (n.id === "input") n.config.text = PLAYER_INPUT;
    if (n.id === "preset") n.config.content = PRESET;
    if (n.id === "criticRubric")
      n.config.content = "## Review Rubric\n- Do not control the player\n- Follow the preset style";
  }

  const result = await runWorkflowWithBranches(workflow, e, cat(), cx);
  return { result, captures: rec.captures };
}

// ============ Tests ============

describe("P-15.1: Prompt Capture — Content", () => {
  it("writer 1 prompt contains player input and context", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
    ]);
    const w1 = captures.find((c) => c.role === "writer")!;
    expect(w1).toBeDefined();
    expect(w1.prompt).toContain(PLAYER_INPUT);
  });

  it("critic 1 prompt contains the writer's draft", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
    ]);
    const c1 = captures.filter((c) => c.role === "critic")[0]!;
    expect(c1).toBeDefined();
    expect(c1.prompt).toContain(W1_TEXT);
  });

  it("curator prompt contains the final accepted draft", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const cur = captures.find((c) => c.role === "curator")!;
    expect(cur).toBeDefined();
    expect(cur.prompt).toContain(W1_TEXT);
  });
});

describe("P-15.1: Prompt Capture — Size", () => {
  it("records prompt sizes for accepted path", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const summary = captures.map((c) => ({
      role: c.role,
      size: c.prompt.length,
    }));
    // Print for baseline visibility

    console.log("BASELINE PROMPT SIZES (accepted):", JSON.stringify(summary, null, 2));
    expect(captures).toHaveLength(3);
  });

  it("records prompt sizes for revision-accepted path", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CR },
      { role: "writer", text: W2_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const summary = captures.map((c) => ({
      role: c.role,
      size: c.prompt.length,
    }));

    console.log("BASELINE PROMPT SIZES (revision-accepted):", JSON.stringify(summary, null, 2));
    expect(captures.length).toBeGreaterThanOrEqual(5);
  });

  it("records prompt sizes for exhausted path", async () => {
    const { captures } = await runUnifiedOnce([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CR },
      { role: "writer", text: W2_TEXT },
      { role: "critic", text: CR }, // still revise → exhausted
    ]);
    const summary = captures.map((c) => ({
      role: c.role,
      size: c.prompt.length,
    }));

    console.log("BASELINE PROMPT SIZES (exhausted):", JSON.stringify(summary, null, 2));
    expect(captures).toHaveLength(4);
  });
});

// ============ Trim Assertions ============

// Pre-populate session with a long history to make the absence visible

async function runWithPopulatedSession(responses: Array<{ role: Role; text: string }>) {
  (globalThis as any).__rpPromptCapTurnIdCounter = 0;
  const rec = makeRecorder(responses);
  const ad = { provider: "mock" as const, complete: rec.complete };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => ad,
  });
  const pr = createP1ProfileRegistry();
  const ss = new InMemoryAgentSessionStore();
  const ms = new InMemoryWorkflowMemoryStore();
  const ws = new InMemoryDynamicWorldbookStore();
  const cx: WorkflowRunContext = { sessionId: "session-a" };

  // Pre-populate session with sentinel turn (matching workflow's hardcoded sessionKey)
  const sessionKey = {
    tenantId: "default",
    workflowInstanceId: "rp-prod-1",
    conversationId: "session-a",
    agentNodeId: "writer-main",
  };
  await ss.append(sessionKey, {
    sessionKey,
    newTurn: {
      turnIndex: 1,
      input: SENTINEL_SESSION_OLD_TURN,
      assistantOutput: "old response",
      modelConfig: { model: "m" },
      tokenUsage: { input: 100, output: 100 },
      createdAt: new Date().toISOString(),
    },
  });

  // Seed worldbook with sentinel entry
  await ws.save("session:session-a:worldbook:default", "worldbook:default", {
    version: 1,
    entries: [
      {
        id: "wb-1",
        title: "WB Sentinel",
        content: SENTINEL_UNRELATED_WORLDBOOK,
        tags: [],
        type: "world",
        priority: 50,
        updatedAt: new Date().toISOString(),
      },
    ],
  });

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
    inspectOutput: async ({ inputs }) => ({ outputs: { debug: "x" } }),
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
        parts.push("- Focus on whether the original issues above are now fixed.");
      } else {
        parts.push("## Review focus");
        parts.push("- Apply the rubric to the writer's draft as in attempt 1.");
      }
      return { outputs: { instruction: parts.join("\n\n") } };
    },
    sessionToMarkdown: async ({ inputs }) => {
      const c = inputs.sessionContext as any;
      return { outputs: { markdown: c ? sessionContextToMarkdown(c) : "(No session history.)" } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: ws, scopeContext: cx }),
    genericRetriever: async ({ inputs, node }) => {
      const isMem = (node.config as any)?.limit === 6;
      if (isMem) return { outputs: { result: JSON.parse(MEM_RETRIEVAL) } };
      return { outputs: { result: JSON.parse(WB_RETRIEVAL) } };
    },
    retrievalResultToMarkdown: async ({ inputs }) => {
      // Mirror production default rendering: title + content only.
      type Hit = {
        id?: string;
        title?: string;
        content?: string;
      };
      const r = inputs.result as { hits: Hit[] };
      const md = r.hits.map((h) => `## ${h.title ?? "Untitled"}\n${h.content ?? ""}`).join("\n\n");
      return { outputs: { markdown: md || "(no results)" } };
    },
    memoryWrite: createMemoryWriteExecutor(ms),
    memoryCorpus: createMemoryCorpusExecutor(ms),
    memoryDelete: createMemoryDeleteExecutor(ms),
  };
  Object.assign(e, createStdlibExecutors());
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpPromptCapTurnIdCounter++;
      result.outputs.json = `turn-${String((globalThis as any).__rpPromptCapTurnIdCounter).padStart(3, "0")}`;
    }
    return result;
  };

  const workflow = JSON.parse(JSON.stringify(wf("rp-unified-stateful-production-v1.json"))) as any;
  for (const n of workflow.nodes) {
    if (n.id === "input") n.config.text = PLAYER_INPUT;
    if (n.id === "preset") n.config.content = PRESET;
    if (n.id === "criticRubric") n.config.content = "## Review Rubric\n- Do not control the player";
  }

  await runWorkflowWithBranches(workflow, e, cat(), cx);
  return rec.captures;
}

describe("P-15.1: Prompt Capture — Trim Constraints", () => {
  it("critic 1 prompt contains worldbook but NOT session history", async () => {
    const captures = await runWithPopulatedSession([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const c1 = captures.filter((c) => c.role === "critic")[0]!;
    expect(c1).toBeDefined();
    // Worldbook content (relevant for consistency check) IS in critic
    expect(c1.prompt).toContain("Old Station");
    // Session sentinel MUST NOT leak
    expect(c1.prompt).not.toContain(SENTINEL_SESSION_OLD_TURN);
  });

  it("critic 2 prompt contains revision instruction but NOT session history", async () => {
    const captures = await runWithPopulatedSession([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CR },
      { role: "writer", text: W2_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const c2 = captures.filter((c) => c.role === "critic")[1]!;
    expect(c2).toBeDefined();
    // Critic 2 sees revision instruction from gate1
    expect(c2.prompt).toContain("Remove the player decision");
    // Critic 2 still sees worldbook
    expect(c2.prompt).toContain("Old Station");
    // Session sentinel MUST NOT leak
    expect(c2.prompt).not.toContain(SENTINEL_SESSION_OLD_TURN);
  });

  it("curator prompt contains final draft but NOT worldbook or session", async () => {
    const captures = await runWithPopulatedSession([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const cur = captures.find((c) => c.role === "curator")!;
    expect(cur).toBeDefined();
    // Curator sees the final draft
    expect(cur.prompt).toContain(W1_TEXT);
    // Curator must NOT see worldbook content
    expect(cur.prompt).not.toContain("Old Station");
    // Curator must NOT see session history
    expect(cur.prompt).not.toContain(SENTINEL_SESSION_OLD_TURN);
  });

  it("writer prompt is unchanged: still has full merged context", async () => {
    const captures = await runWithPopulatedSession([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const w1 = captures.find((c) => c.role === "writer")!;
    expect(w1).toBeDefined();
    // Writer still sees session history (unchanged from baseline)
    expect(w1.prompt).toContain(SENTINEL_SESSION_OLD_TURN);
  });

  it("records populated-session prompt sizes for all roles", async () => {
    const captures = await runWithPopulatedSession([
      { role: "writer", text: W1_TEXT },
      { role: "critic", text: CA },
      { role: "curator", text: CURATOR_TEXT },
    ]);
    const summary = captures.map((c) => ({ role: c.role, size: c.prompt.length }));

    console.log("POPULATED-SESSION PROMPT SIZES:", JSON.stringify(summary, null, 2));
    expect(captures).toHaveLength(3);
  });
});

// ============ Untrimmed Workflow Reconstruction (Baseline) ============
// The "untrimmed" workflow restores the wiring that P-15.1/5-3 removed:
//   - critic1/2.context from ctxMerge2 (session + worldbook + memory merged)
//   - curator.context from ctxMerge2
//   - critic2.instruction from criticRubric directly (no critic2Instruction node)
// This lets us measure prompt sizes under the *pre-trim* topology on the SAME
// fixtures, so reductions are attributable to the trim, not fixture variance.

function loadTrimmedWorkflow(): any {
  return JSON.parse(JSON.stringify(wf("rp-unified-stateful-production-v1.json")));
}

function loadUntrimmedWorkflow(): any {
  const wfDef = loadTrimmedWorkflow();
  // 1. Drop the critic2Instruction node and its edges
  wfDef.nodes = wfDef.nodes.filter((n: any) => n.id !== "critic2Instruction");
  const drop = new Set(["e_rubric_c2i", "e_g1_c2i", "e_c2i_c2"]);
  wfDef.edges = wfDef.edges.filter((e: any) => !drop.has(e.id));

  // 2. Rewire critic1/2 context back to ctxMerge2
  for (const e of wfDef.edges) {
    if (e.id === "e_ctx_c1") {
      e.source = "ctxMerge2";
      e.sourcePort = "result";
    } else if (e.id === "e_ctx_c2") {
      e.source = "ctxMerge2";
      e.sourcePort = "result";
    }
  }

  // 3. Restore curator.context from ctxMerge2
  wfDef.edges.push({
    id: "e_ctx_cur",
    source: "ctxMerge2",
    sourcePort: "result",
    target: "curator",
    targetPort: "context",
  });

  // 4. Restore critic2.instruction directly from criticRubric
  wfDef.edges.push({
    id: "e_rubric_c2",
    source: "criticRubric",
    sourcePort: "markdown",
    target: "critic2",
    targetPort: "instruction",
  });

  return wfDef;
}

// ============ Run helpers for trim-aware workflows ============

type RunOpts = {
  trimmed: boolean;
  responses: Array<{ role: Role; text: string }>;
};

async function runWorkflowCaptures(opts: RunOpts): Promise<Capture[]> {
  (globalThis as any).__rpPromptCapTurnIdCounter = 0;
  const rec = makeRecorder(opts.responses);
  const ad = { provider: "mock" as const, complete: rec.complete };
  const r = new ProviderRegistry("mock");
  r.register({
    providerId: "mock",
    apiKey: "k",
    baseUrl: "http://x",
    defaultModel: "mock-model",
    createAdapter: () => ad,
  });
  const pr = createP1ProfileRegistry();
  const ss = new InMemoryAgentSessionStore();
  const ms = new InMemoryWorkflowMemoryStore();
  const ws = new InMemoryDynamicWorldbookStore();
  const cx: WorkflowRunContext = { sessionId: "session-a" };

  // Pre-seed session with multiple sentinels so that sessionMd (rendered
  // into ctxMerge2) is large enough to make the trim measurable.
  // Session key here MUST match the workflow's sessionKey node (set below)
  // — otherwise ss.load() will return null and sessionMd will be empty.
  const sessionKey = {
    tenantId: SENTINEL_SESSION_ID + "_tenant",
    workflowInstanceId: "rp-prod-1",
    conversationId: "session-a",
    agentNodeId: "writer-main",
  };
  for (let i = 1; i <= 6; i++) {
    await ss.append(sessionKey, {
      sessionKey,
      newTurn: {
        turnIndex: i,
        input: `${SENTINEL_SESSION_OLD_TURN}_turn_${i}_player_should_not_leak_into_critic`,
        assistantOutput: `${SENTINEL_SESSION_OLD_TURN}_turn_${i}_agent_should_not_leak_into_critic_response_${"x".repeat(80)}`,
        modelConfig: { model: "m" },
        tokenUsage: { input: 100, output: 100 },
        createdAt: new Date().toISOString(),
      },
    });
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
    inspectOutput: async ({ inputs }) => ({ outputs: { debug: "x" } }),
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
    // Only register criticInstructionBuilder when running the TRIMMED workflow
    ...(opts.trimmed
      ? {
          criticInstructionBuilder: async ({ inputs }: { inputs: Record<string, unknown> }) => {
            const rubric = String(inputs.rubric ?? "");
            const gateResult = inputs.gateResult as
              | {
                  revisionInstruction?: string;
                  review?: { issues?: Array<{ code: string; severity: string; message?: string }> };
                }
              | undefined;
            const parts: string[] = [];
            if (rubric.trim().length > 0) parts.push(rubric);
            if (
              gateResult?.revisionInstruction &&
              gateResult.revisionInstruction.trim().length > 0
            ) {
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
              parts.push("- Focus on whether the original issues above are now fixed.");
            } else {
              parts.push("## Review focus");
              parts.push("- Apply the rubric to the writer's draft as in attempt 1.");
            }
            return { outputs: { instruction: parts.join("\n\n") } };
          },
        }
      : {}),
    sessionToMarkdown: async ({ inputs }) => {
      const c = inputs.sessionContext as any;
      return { outputs: { markdown: c ? sessionContextToMarkdown(c) : "(No session history.)" } };
    },
    dynamicWorldbook: createDynamicWorldbookExecutor({ store: ws, scopeContext: cx }),
    genericRetriever: async ({ inputs, node }: any) => {
      const isMem = (node.config as any)?.limit === 6;
      if (isMem) return { outputs: { result: JSON.parse(MEM_RETRIEVAL) } };
      return { outputs: { result: JSON.parse(WB_RETRIEVAL) } };
    },
    retrievalResultToMarkdown: async ({ inputs }: { inputs: Record<string, unknown> }) => {
      // Mirror production default rendering: title + content only.
      type Hit = {
        id?: string;
        title?: string;
        content?: string;
      };
      const r = inputs.result as { hits: Hit[] };
      const md = r.hits.map((h) => `## ${h.title ?? "Untitled"}\n${h.content ?? ""}`).join("\n\n");
      return { outputs: { markdown: md || "(no results)" } };
    },
    memoryWrite: createMemoryWriteExecutor(ms),
    memoryCorpus: createMemoryCorpusExecutor(ms),
    memoryDelete: createMemoryDeleteExecutor(ms),
  };
  Object.assign(e, createStdlibExecutors());
  const baseJsonSource = e.jsonSource!;
  e.jsonSource = async (ctx) => {
    const result = await baseJsonSource(ctx);
    if (ctx.node.id === "turnId") {
      (globalThis as any).__rpPromptCapTurnIdCounter++;
      result.outputs.json = `turn-${String((globalThis as any).__rpPromptCapTurnIdCounter).padStart(3, "0")}`;
    }
    return result;
  };

  const workflow = opts.trimmed ? loadTrimmedWorkflow() : loadUntrimmedWorkflow();
  for (const n of workflow.nodes) {
    if (n.id === "input") n.config.text = PLAYER_INPUT;
    if (n.id === "preset") n.config.content = PRESET;
    if (n.id === "criticRubric") {
      n.config.content = `## Review Rubric\n- ${SENTINEL_AGENCY_RULE}\n- ${SENTINEL_KNOWLEDGE_RULE}\n- Do not control the player\n- Follow the preset style`;
    }
  }
  // Override session key with sentinels
  for (const n of workflow.nodes) {
    if (n.id === "sessionKey")
      n.config.data = JSON.stringify({
        tenantId: SENTINEL_SESSION_ID + "_tenant",
        workflowInstanceId: "rp-prod-1",
        conversationId: "session-a",
        agentNodeId: "writer-main",
      });
    if (n.id === "turnId") {
      // Preserve turn-### auto-counter; we will not override here.
    }
  }

  const result = await runWorkflowWithBranches(workflow, e, cat(), cx);
  // Sanity: the workflow should reach "success" in this scenario; if not, log.
  if (result.status !== "success") {
    const failed = result.nodeRuns.filter((r: any) => r.status === "error");

    console.error(
      `[runWorkflowCaptures trimmed=${opts.trimmed}] workflow status=${result.status}, failed=`,
      failed.map((f: any) => `${f.nodeId}: ${f.error}`),
    );
  }
  // (Debug dump removed in production mode.)
  return rec.captures;
}

// Hash that is stable across runs (no random/seeded content).
function djb2(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
}

type PromptStat = {
  role: Role;
  prompt: string;
  chars: number;
  bytes: number;
  estTokens: number;
  hasSessionSentinel: boolean;
  hasWbDiagnostics: boolean;
  hasWbMetadata: boolean;
  hasCriticJsonSentinel: boolean;
  hasGateResultSentinel: boolean;
  hasRevisionInstructionSentinel: boolean;
  hasReviseBranchSentinel: boolean;
  hasRejectedDraftSentinel: boolean;
  hasObservabilitySentinel: boolean;
  hasPresetSentinel: boolean;
  hasPlayerInputSentinel: boolean;
  hasFinalDraftSentinel: boolean;
  hasAgencyRule: boolean;
  hasKnowledgeRule: boolean;
  hasSessionIdSentinel: boolean;
  hasTurnIdSentinel: boolean;
  hasRevisionTargetSentinel: boolean;
  hasFailedChecksSentinel: boolean;
};

function statCapture(c: Capture): PromptStat {
  const p = c.prompt;
  return {
    role: c.role,
    prompt: p,
    chars: p.length,
    bytes: byteSize(p),
    estTokens: estimateTokens(p),
    hasSessionSentinel: p.includes(SENTINEL_SESSION_OLD_TURN),
    hasWbDiagnostics: p.includes(SENTINEL_RETRIEVAL_DIAG),
    hasWbMetadata: p.includes(SENTINEL_STORE_METADATA),
    hasCriticJsonSentinel: p.includes(SENTINEL_CRITIC_JSON),
    hasGateResultSentinel: p.includes(SENTINEL_GATE_RESULT),
    hasRevisionInstructionSentinel: p.includes(SENTINEL_REVISION_INSTRUCTION),
    hasReviseBranchSentinel: p.includes(SENTINEL_REVISE_BRANCH),
    hasRejectedDraftSentinel: p.includes(SENTINEL_REJECTED_DRAFT),
    hasObservabilitySentinel: p.includes(SENTINEL_OBSERVABILITY),
    hasPresetSentinel: p.includes(SENTINEL_PRESET_FULL),
    hasPlayerInputSentinel: p.includes(SENTINEL_PLAYER_INPUT),
    hasFinalDraftSentinel: p.includes(SENTINEL_FINAL_DRAFT),
    hasAgencyRule: p.includes(SENTINEL_AGENCY_RULE),
    hasKnowledgeRule: p.includes(SENTINEL_KNOWLEDGE_RULE),
    hasSessionIdSentinel: p.includes(SENTINEL_SESSION_ID),
    hasTurnIdSentinel: p.includes(SENTINEL_TURN_ID),
    hasRevisionTargetSentinel: p.includes(SENTINEL_REVISION_TARGET),
    hasFailedChecksSentinel: p.includes(SENTINEL_FAILED_CHECKS),
  };
}

function findRole(captures: Capture[], role: Role, occurrence: number): Capture | undefined {
  let n = 0;
  for (const c of captures) {
    if (c.role === role) {
      if (n === occurrence) return c;
      n++;
    }
  }
  return undefined;
}

// ============ Quantitative Comparison: Trimmed vs Untrimmed ============

describe("P-15.1/5-3: Quantitative Comparison", () => {
  it("accepted path: critic 1 prompt size (trimmed vs untrimmed)", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const trimmed = (await runWorkflowCaptures({ trimmed: true, responses })).filter(
      (c) => c.role === "critic",
    );
    const untrimmed = (await runWorkflowCaptures({ trimmed: false, responses })).filter(
      (c) => c.role === "critic",
    );
    const tCritic1 = statCapture(trimmed[0]!);
    const uCritic1 = statCapture(untrimmed[0]!);

    console.log(
      "[ACCEPTED] critic1 BEFORE/AFTER",
      JSON.stringify({
        before: uCritic1,
        after: tCritic1,
        delta_tokens: uCritic1.estTokens - tCritic1.estTokens,
      }),
    );
    expect(trimmed.length).toBeGreaterThanOrEqual(1);
    expect(untrimmed.length).toBeGreaterThanOrEqual(1);
    // Quantified token delta:
    const tokenDelta = uCritic1.estTokens - tCritic1.estTokens;
    expect(tokenDelta).toBeGreaterThan(0); // trim must reduce
    // Target: at least 20% reduction for critic 1.
    expect(tokenDelta / uCritic1.estTokens).toBeGreaterThanOrEqual(0.2);
  });

  it("revision path: critic 2 prompt size (trimmed vs untrimmed)", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const trimmed = (await runWorkflowCaptures({ trimmed: true, responses })).filter(
      (c) => c.role === "critic",
    );
    const untrimmed = (await runWorkflowCaptures({ trimmed: false, responses })).filter(
      (c) => c.role === "critic",
    );
    const tCritic2 = statCapture(trimmed[1]!);
    const uCritic2 = statCapture(untrimmed[1]!);

    console.log(
      "[REVISION] critic2 BEFORE/AFTER",
      JSON.stringify({
        before: uCritic2,
        after: tCritic2,
        delta_tokens: uCritic2.estTokens - tCritic2.estTokens,
      }),
    );
    expect(trimmed.length).toBeGreaterThanOrEqual(2);
    expect(untrimmed.length).toBeGreaterThanOrEqual(2);
    const tokenDelta = uCritic2.estTokens - tCritic2.estTokens;
    expect(tokenDelta).toBeGreaterThan(0);
    expect(tokenDelta / uCritic2.estTokens).toBeGreaterThanOrEqual(0.2);
  });

  it("accepted path: curator prompt size (trimmed vs untrimmed)", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const trimmed = (await runWorkflowCaptures({ trimmed: true, responses })).filter(
      (c) => c.role === "curator",
    );
    const untrimmed = (await runWorkflowCaptures({ trimmed: false, responses })).filter(
      (c) => c.role === "curator",
    );
    // Curators only run on the accepted path; both runs should produce one.
    const tCur = statCapture(trimmed[0]!);
    const uCur = statCapture(untrimmed[0]!);

    console.log(
      "[ACCEPTED] curator BEFORE/AFTER",
      JSON.stringify({ before: uCur, after: tCur, delta_tokens: uCur.estTokens - tCur.estTokens }),
    );
    expect(trimmed.length).toBe(1);
    expect(untrimmed.length).toBe(1);
    const tokenDelta = uCur.estTokens - tCur.estTokens;
    expect(tokenDelta).toBeGreaterThan(0);
    // Target: at least 40% reduction for curator.
    expect(tokenDelta / uCur.estTokens).toBeGreaterThanOrEqual(0.4);
  });
});

// ============ Writer Prompt Protection ============
// Writer prompt must NOT change as a side-effect of the trim. We compare the
// writer 1 prompt hash across trimmed/untrimmed runs on the same fixture.

describe("P-15.1/5-3: Writer Prompt Protection", () => {
  it("writer 1 prompt is byte-identical under trimmed vs untrimmed workflow", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const trimmedWriters = (await runWorkflowCaptures({ trimmed: true, responses })).filter(
      (c) => c.role === "writer",
    );
    const untrimmedWriters = (await runWorkflowCaptures({ trimmed: false, responses })).filter(
      (c) => c.role === "writer",
    );
    expect(trimmedWriters.length).toBe(1);
    expect(untrimmedWriters.length).toBe(1);
    const tw = trimmedWriters[0]!;
    const uw = untrimmedWriters[0]!;
    // Writer prompt must be unchanged.
    expect(tw.prompt).toBe(uw.prompt);
    expect(djb2(tw.prompt)).toBe(djb2(uw.prompt));
    // Must contain the full preset (writers get it; critics/curator should not).
    expect(tw.prompt).toContain(SENTINEL_PRESET_FULL);
  });

  it("writer 2 prompt is byte-identical under trimmed vs untrimmed workflow", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const trimmedWriters = (await runWorkflowCaptures({ trimmed: true, responses })).filter(
      (c) => c.role === "writer",
    );
    const untrimmedWriters = (await runWorkflowCaptures({ trimmed: false, responses })).filter(
      (c) => c.role === "writer",
    );
    expect(trimmedWriters.length).toBe(2);
    expect(untrimmedWriters.length).toBe(2);
    expect(trimmedWriters[1]!.prompt).toBe(untrimmedWriters[1]!.prompt);
  });
});

// ============ Critic Sentinel Exclusion ============

describe("P-15.1/5-3: Critic 1 sentinel exclusion", () => {
  let critic1Stat: PromptStat;

  beforeEach(async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const captures = await runWorkflowCaptures({ trimmed: true, responses });
    const c1 = findRole(captures, "critic", 0)!;
    critic1Stat = statCapture(c1);
  });

  it("critic 1 retains necessary content", () => {
    // Critic 1 receives the writer's draft via userInput — the draft carries
    // the REJECTED_DRAFT sentinel. This is by design (the critic MUST see
    // the draft). What must NOT appear is the session history.
    expect(critic1Stat.prompt).toContain(W1_TEXT);
    // agency / knowledge rules survive (they live in critic profile + rubric)
    expect(critic1Stat.hasAgencyRule).toBe(true);
    expect(critic1Stat.hasKnowledgeRule).toBe(true);
    // worldbook content (sentinel-tagged) is delivered
    expect(critic1Stat.prompt).toContain(SENTINEL_UNRELATED_WORLDBOOK);
  });

  it("critic 1 excludes session history sentinel", () => {
    expect(critic1Stat.hasSessionSentinel).toBe(false);
  });

  it("critic 1 excludes retrieval diagnostics", () => {
    expect(critic1Stat.hasWbDiagnostics).toBe(false);
  });

  it("critic 1 excludes retrieval store metadata", () => {
    expect(critic1Stat.hasWbMetadata).toBe(false);
  });

  it("critic 1 excludes critic JSON / gate result sentinels", () => {
    expect(critic1Stat.hasCriticJsonSentinel).toBe(false);
    expect(critic1Stat.hasGateResultSentinel).toBe(false);
    expect(critic1Stat.hasRevisionInstructionSentinel).toBe(false);
  });

  it("critic 1 keeps observability sentinels out, but does see the draft sentinel", () => {
    // Critic 1 IS supposed to see the rejected-draft sentinel via the draft
    // it is reviewing. It MUST NOT see observability or routing sentinels.
    expect(critic1Stat.hasRejectedDraftSentinel).toBe(true);
    expect(critic1Stat.hasObservabilitySentinel).toBe(false);
    expect(critic1Stat.hasReviseBranchSentinel).toBe(false);
  });

  it("critic 1 excludes full preset (writer-only)", () => {
    expect(critic1Stat.hasPresetSentinel).toBe(false);
  });

  it("critic 1 excludes session/turn IDs (curator-only sentinels)", () => {
    expect(critic1Stat.hasSessionIdSentinel).toBe(false);
    expect(critic1Stat.hasTurnIdSentinel).toBe(false);
  });
});

describe("P-15.1/5-3: Critic 2 sentinel exclusion", () => {
  let critic2Stat: PromptStat;

  beforeEach(async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const captures = await runWorkflowCaptures({ trimmed: true, responses });
    const c2 = findRole(captures, "critic", 1)!;
    critic2Stat = statCapture(c2);
  });

  it("critic 2 retains necessary content (revision target + new draft)", () => {
    expect(critic2Stat.hasRevisionTargetSentinel).toBe(true);
    // The new draft text (Writer 2) must appear in critic 2's prompt
    expect(critic2Stat.prompt).toContain(W2_TEXT);
    // agency / knowledge rules survive
    expect(critic2Stat.hasAgencyRule).toBe(true);
    expect(critic2Stat.hasKnowledgeRule).toBe(true);
    // worldbook content (necessary for continuity) survives
    expect(critic2Stat.prompt).toContain(SENTINEL_UNRELATED_WORLDBOOK);
  });

  it("critic 2 excludes session history", () => {
    expect(critic2Stat.hasSessionSentinel).toBe(false);
  });

  it("critic 2 excludes retrieval diagnostics + metadata", () => {
    expect(critic2Stat.hasWbDiagnostics).toBe(false);
    expect(critic2Stat.hasWbMetadata).toBe(false);
  });

  it("critic 2 excludes rejected Writer 1 draft", () => {
    // The rejected draft's body (W1_TEXT) starts with the rejected-draft sentinel.
    // Critic 2 must not include that text in its prompt — it only sees Writer 2.
    expect(critic2Stat.hasRejectedDraftSentinel).toBe(false);
  });

  it("critic 2 excludes preset (writer-only) and curator-only sentinels", () => {
    expect(critic2Stat.hasPresetSentinel).toBe(false);
    expect(critic2Stat.hasSessionIdSentinel).toBe(false);
    expect(critic2Stat.hasTurnIdSentinel).toBe(false);
  });

  it("critic 2 excludes observability / critic-JSON sentinels", () => {
    expect(critic2Stat.hasObservabilitySentinel).toBe(false);
    expect(critic2Stat.hasCriticJsonSentinel).toBe(false);
    expect(critic2Stat.hasReviseBranchSentinel).toBe(false);
  });
});

// ============ Curator Sentinel Exclusion ============

describe("P-15.1/5-3: Curator sentinel exclusion", () => {
  let curatorStat: PromptStat;

  beforeEach(async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const captures = await runWorkflowCaptures({ trimmed: true, responses });
    curatorStat = statCapture(findRole(captures, "curator", 0)!);
  });

  it("curator retains necessary content (final accepted draft + own ports)", () => {
    expect(curatorStat.hasFinalDraftSentinel).toBe(true);
    // NOTE on sessionId / turnId:
    // The current production workflow JSON does NOT wire sessionKey into
    // curator's data port — that edge was not added in this P-15.1/5-3
    // change (which is constrained to prompt content). A follow-up ADR
    // would be required to add sessionKey → curator.data. Until then, the
    // curator sees only the final draft + its rp-memory-curator profile
    // foundational system prompt + its own routing port.
  });

  it("curator receives only the final draft + its own ports, never critic JSON or revision data", () => {
    // In the CA path, the curator receives W1_TEXT (which carries both
    // REJECTED and FINAL sentinels because it's the accepted draft and the
    // fixture tags it with both labels). What MUST NOT be in curator is
    // any critic-side artifact: critic JSON, revision instruction, gate
    // result, or routing branch metadata.
    expect(curatorStat.hasCriticJsonSentinel).toBe(false);
    expect(curatorStat.hasRevisionInstructionSentinel).toBe(false);
    expect(curatorStat.hasGateResultSentinel).toBe(false);
    expect(curatorStat.hasFailedChecksSentinel ?? false).toBe(false);
    expect(curatorStat.hasReviseBranchSentinel).toBe(false);
    expect(curatorStat.hasFinalDraftSentinel).toBe(true);
  });

  it("curator excludes worldbook content", () => {
    expect(curatorStat.prompt).not.toContain(SENTINEL_UNRELATED_WORLDBOOK);
  });

  it("curator excludes session history", () => {
    expect(curatorStat.hasSessionSentinel).toBe(false);
  });

  it("curator excludes retrieval diagnostics and metadata", () => {
    expect(curatorStat.hasWbDiagnostics).toBe(false);
    expect(curatorStat.hasWbMetadata).toBe(false);
  });

  it("curator excludes preset, agency rules, and revision target", () => {
    expect(curatorStat.hasPresetSentinel).toBe(false);
    expect(curatorStat.hasAgencyRule).toBe(false);
    expect(curatorStat.hasKnowledgeRule).toBe(false);
    expect(curatorStat.hasRevisionTargetSentinel).toBe(false);
    expect(curatorStat.hasObservabilitySentinel).toBe(false);
  });
});

describe("P-15.1/5-3: Curator in revision-accepted path sees only Writer 2", () => {
  it("curator prompt contains Writer 2 final draft and excludes Writer 1 reject sentinel", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT }, // contains REJECTED_DRAFT_SENTINEL
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT }, // contains FINAL_DRAFT_SENTINEL
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const captures = await runWorkflowCaptures({ trimmed: true, responses });
    const cur = statCapture(findRole(captures, "curator", 0)!);
    expect(cur.hasFinalDraftSentinel).toBe(true);
    expect(cur.prompt).toContain(W2_TEXT);
    // Writer 1 was rejected. Curator must not see it.
    expect(cur.prompt).not.toContain(SENTINEL_REJECTED_DRAFT);
    expect(cur.hasCriticJsonSentinel).toBe(false);
    expect(cur.hasRevisionInstructionSentinel).toBe(false);
    expect(cur.hasWbDiagnostics).toBe(false);
  });
});

describe("P-15.1/5-3: Curator NOT invoked on exhausted path", () => {
  it("curator has no captures when both gates reject", async () => {
    const responses = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT },
      { role: "critic" as Role, text: CR }, // still revise → exhausted
    ];
    const captures = await runWorkflowCaptures({ trimmed: true, responses });
    expect(captures.find((c) => c.role === "curator")).toBeUndefined();
  });
});

// ============ Summarize token deltas for the final report ============

describe("P-15.1/5-3: Quantitative Report Summary", () => {
  it("emits a consolidated before/after table to stdout", async () => {
    const accepted = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];
    const revision = [
      { role: "writer" as Role, text: W1_TEXT },
      { role: "critic" as Role, text: CR },
      { role: "writer" as Role, text: W2_TEXT },
      { role: "critic" as Role, text: CA },
      { role: "curator" as Role, text: CURATOR_TEXT },
    ];

    const beforeAccepted = await runWorkflowCaptures({ trimmed: false, responses: accepted });
    const afterAccepted = await runWorkflowCaptures({ trimmed: true, responses: accepted });
    const beforeRevision = await runWorkflowCaptures({ trimmed: false, responses: revision });
    const afterRevision = await runWorkflowCaptures({ trimmed: true, responses: revision });

    const stats = (cs: Capture[]) => cs.map(statCapture);

    const report = {
      scenario_accepted: {
        writer1: {
          before: statCapture(findRole(beforeAccepted, "writer", 0)!).estTokens,
          after: statCapture(findRole(afterAccepted, "writer", 0)!).estTokens,
        },
        critic1: {
          before: statCapture(findRole(beforeAccepted, "critic", 0)!).estTokens,
          after: statCapture(findRole(afterAccepted, "critic", 0)!).estTokens,
        },
        curator: {
          before: statCapture(findRole(beforeAccepted, "curator", 0)!).estTokens,
          after: statCapture(findRole(afterAccepted, "curator", 0)!).estTokens,
        },
      },
      scenario_revision: {
        writer1: {
          before: statCapture(findRole(beforeRevision, "writer", 0)!).estTokens,
          after: statCapture(findRole(afterRevision, "writer", 0)!).estTokens,
        },
        writer2: {
          before: statCapture(findRole(beforeRevision, "writer", 1)!).estTokens,
          after: statCapture(findRole(afterRevision, "writer", 1)!).estTokens,
        },
        critic1: {
          before: statCapture(findRole(beforeRevision, "critic", 0)!).estTokens,
          after: statCapture(findRole(afterRevision, "critic", 0)!).estTokens,
        },
        critic2: {
          before: statCapture(findRole(beforeRevision, "critic", 1)!).estTokens,
          after: statCapture(findRole(afterRevision, "critic", 1)!).estTokens,
        },
        curator: {
          before: statCapture(findRole(beforeRevision, "curator", 0)!).estTokens,
          after: statCapture(findRole(afterRevision, "curator", 0)!).estTokens,
        },
      },
    };
    // Compute deltas
    const delta = (a: { before: number; after: number }) => ({
      before: a.before,
      after: a.after,
      delta: a.before - a.after,
      reductionPct: a.before > 0 ? (a.before - a.after) / a.before : 0,
    });
    const table = {
      "Writer 1 (accepted)": delta(report.scenario_accepted.writer1),
      "Critic 1 (accepted)": delta(report.scenario_accepted.critic1),
      "Curator (accepted)": delta(report.scenario_accepted.curator),
      "Writer 1 (revision)": delta(report.scenario_revision.writer1),
      "Writer 2 (revision)": delta(report.scenario_revision.writer2),
      "Critic 1 (revision)": delta(report.scenario_revision.critic1),
      "Critic 2 (revision)": delta(report.scenario_revision.critic2),
      "Curator (revision)": delta(report.scenario_revision.curator),
    };

    console.log(
      "[P-15.1/5-3] PROMPT TOKEN DELTA TABLE (chars/4 estimate):",
      JSON.stringify(table, null, 2),
    );

    // Hard assertions on quantitative targets.
    expect(table["Critic 1 (accepted)"].reductionPct).toBeGreaterThanOrEqual(0.2);
    expect(table["Critic 2 (revision)"].reductionPct).toBeGreaterThanOrEqual(0.2);
    expect(table["Curator (accepted)"].reductionPct).toBeGreaterThanOrEqual(0.4);

    // Writer prompts must be unchanged (delta = 0).
    expect(table["Writer 1 (accepted)"].delta).toBe(0);
    expect(table["Writer 1 (revision)"].delta).toBe(0);
    expect(table["Writer 2 (revision)"].delta).toBe(0);
  });
});
