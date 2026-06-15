/**
 * P-9 RP Critic Contract & Quality Gate E2E Tests
 *
 * Proves: rp-critic profile → structured review → quality gate → accept/revise decision.
 * 5 scenarios: accept, revise, score-threshold, error-issue, illegal-json.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  validateWorkflow,
  runWorkflow,
  nodeRegistry,
  type WorkflowDefinition,
  type NodeExecutor,
  type NodeCatalog,
} from "@awp/workflow-core";
import { stdlibNodes, createStdlibExecutors } from "@awp/workflow-stdlib";
import {
  ProviderRegistry,
  InMemorySpecializedAgentProfileRegistry,
  createP1ProfileRegistry,
  createSpecializedAgentExecutor,
  rpCriticQualityGateNode,
  rpCriticQualityGateExecutor,
  validateReviewSchema,
  applyGate,
  DEFAULT_GATE_CONFIG,
  type RpCriticReviewV1,
} from "./index";

// ============ Helpers ============

function createP9Catalog(): NodeCatalog {
  return {
    ...nodeRegistry,
    ...stdlibNodes,
    rpCriticQualityGate: rpCriticQualityGateNode,
  };
}

function loadWorkflowJson(filename: string): WorkflowDefinition {
  const path = resolve(__dirname, "../../../data/workflows", filename);
  return JSON.parse(readFileSync(path, "utf-8")).workflow as WorkflowDefinition;
}

function createExecutors(
  pr: InMemorySpecializedAgentProfileRegistry,
  writerText: string,
  criticText: string,
): Record<string, NodeExecutor> {
  const callLog: string[] = [];
  const adapter = {
    provider: "mock",
    async complete(p: { model: string; prompt: string; temperature?: number }) {
      callLog.push(p.prompt.slice(0, 100));
      // Return writer text first, then critic text
      const text = callLog.length === 1 ? writerText : criticText;
      return { text, tokenUsage: { input: 100, output: text.length } };
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
    specializedAgent: createSpecializedAgentExecutor({
      registry: r,
      profileRegistry: pr,
      createAdapter: () => adapter,
    }),
    rpCriticQualityGate: rpCriticQualityGateExecutor,
    ...createStdlibExecutors(),
  };
}

// ============ Profile Tests ============

describe("rp-critic Profile", () => {
  const pr = createP1ProfileRegistry();

  it("rp-critic exists in production registry", () => {
    const p = pr.get("rp-critic");
    expect(p).toBeDefined();
    expect(p!.profileId).toBe("rp-critic");
    expect(p!.foundationalSystemPrompt).toContain("critic");
    expect(p!.defaultModelConfig.responseFormat).toBe("json_object");
    expect(p!.lockedFields).toContain("responseFormat");
  });

  it("rp-critic responseFormat is locked to json_object", () => {
    const p = pr.get("rp-critic")!;
    expect(p.defaultModelConfig.responseFormat).toBe("json_object");
    expect(p.lockedFields).toContain("responseFormat");
  });

  it("generic agent does not inherit critic prompt", () => {
    const rp = pr.get("rp-critic")!;
    const st = pr.get("story-writer")!;
    expect(st.foundationalSystemPrompt).not.toBe(rp.foundationalSystemPrompt);
  });

  it("rp-writer does not inherit critic prompt", () => {
    const rp = pr.get("rp-critic")!;
    const wr = pr.get("rp-writer")!;
    expect(wr.foundationalSystemPrompt).not.toBe(rp.foundationalSystemPrompt);
  });

  it("duplicate profileId throws", () => {
    const r2 = new InMemorySpecializedAgentProfileRegistry();
    r2.register({
      profileId: "dup",
      label: { zh: "a", en: "a" },
      description: { zh: "a", en: "a" },
      foundationalSystemPrompt: "x",
      requiredInputs: {
        userInput: { required: true, order: 1 },
        instruction: { required: false, order: 2 },
        context: { required: false, order: 3 },
        data: { required: false, order: 4 },
      },
      inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
      defaultModelConfig: {},
      lockedFields: [],
      declaredToolPermissions: [],
    });
    expect(() =>
      r2.register({
        profileId: "dup",
        label: { zh: "b", en: "b" },
        description: { zh: "b", en: "b" },
        foundationalSystemPrompt: "y",
        requiredInputs: {
          userInput: { required: true, order: 1 },
          instruction: { required: false, order: 2 },
          context: { required: false, order: 3 },
          data: { required: false, order: 4 },
        },
        inputOrder: { userInput: 1, instruction: 2, context: 3, data: 4 },
        defaultModelConfig: {},
        lockedFields: [],
        declaredToolPermissions: [],
      }),
    ).toThrow("duplicate");
  });
});

// ============ Schema Tests ============

const VALID_REVIEW: RpCriticReviewV1 = {
  decision: "accept",
  scores: {
    continuity: 0.9,
    characterConsistency: 0.85,
    playerAgency: 0.95,
    knowledgeBoundary: 0.9,
    styleAndFormat: 0.8,
  },
  issues: [
    { code: "style", severity: "warning", message: "Slightly verbose", suggestion: "Trim by 10%" },
  ],
};

describe("Review Schema Validation", () => {
  it("validates legal review", () => {
    expect(validateReviewSchema(VALID_REVIEW).ok).toBe(true);
  });

  it("rejects score < 0", () => {
    const r = { ...VALID_REVIEW, scores: { ...VALID_REVIEW.scores, continuity: -0.1 } };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("rejects score > 1", () => {
    const r = { ...VALID_REVIEW, scores: { ...VALID_REVIEW.scores, playerAgency: 1.5 } };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("rejects NaN", () => {
    const r = { ...VALID_REVIEW, scores: { ...VALID_REVIEW.scores, knowledgeBoundary: NaN } };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("rejects missing issues", () => {
    const r = { ...VALID_REVIEW, issues: null as unknown };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("rejects invalid issue code", () => {
    const r = {
      ...VALID_REVIEW,
      issues: [{ code: "invalid", severity: "warning", message: "x", suggestion: "y" }],
    };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("rejects revise without revisionInstruction", () => {
    const r: RpCriticReviewV1 = { ...VALID_REVIEW, decision: "revise", revisionInstruction: "" };
    expect(validateReviewSchema(r).ok).toBe(false);
  });

  it("does not mutate input", () => {
    const orig = JSON.parse(JSON.stringify(VALID_REVIEW));
    validateReviewSchema(VALID_REVIEW);
    expect(VALID_REVIEW).toEqual(orig);
  });
});

// ============ Quality Gate Tests ============

describe("Quality Gate", () => {
  it("accepts when all scores above threshold and no error issues", () => {
    const r = applyGate(VALID_REVIEW);
    expect(r.accepted).toBe(true);
    expect(r.decision).toBe("accept");
    expect(r.failedChecks).toHaveLength(0);
  });

  it("revises when a score is below threshold", () => {
    const review = { ...VALID_REVIEW, scores: { ...VALID_REVIEW.scores, playerAgency: 0.3 } };
    const r = applyGate(review);
    expect(r.accepted).toBe(false);
    expect(r.failedChecks.some((f) => f.startsWith("playerAgency"))).toBe(true);
  });

  it("revises on error issue when rejectOnErrorIssue is true", () => {
    const review: RpCriticReviewV1 = {
      ...VALID_REVIEW,
      issues: [
        {
          code: "player-agency",
          severity: "error",
          message: "Controls player",
          suggestion: "Remove decision",
        },
      ],
    };
    const r = applyGate(review, { ...DEFAULT_GATE_CONFIG, rejectOnErrorIssue: true });
    expect(r.accepted).toBe(false);
    expect(r.failedChecks).toContain("has-error-issue");
  });

  it("respects critic decision to revise", () => {
    const review: RpCriticReviewV1 = {
      ...VALID_REVIEW,
      decision: "revise",
      revisionInstruction: "Fix the agency issue",
    };
    const r = applyGate(review);
    expect(r.accepted).toBe(false);
    expect(r.failedChecks).toContain("critic-decision: revise");
  });

  it("failedChecks order is deterministic", () => {
    const review: RpCriticReviewV1 = {
      decision: "revise",
      scores: {
        continuity: 0.5,
        characterConsistency: 0.5,
        playerAgency: 0.5,
        knowledgeBoundary: 0.5,
        styleAndFormat: 0.5,
      },
      issues: [{ code: "continuity", severity: "error", message: "x", suggestion: "y" }],
      revisionInstruction: "Fix",
    };
    const r1 = applyGate(review);
    const r2 = applyGate(review);
    expect(r1.failedChecks).toEqual(r2.failedChecks);
  });

  it("gate does not call LLM (pure function)", () => {
    const r = applyGate(VALID_REVIEW);
    expect(r.accepted).toBeDefined();
    expect(r.review).toEqual(VALID_REVIEW);
  });

  it("config thresholds are respected", () => {
    const review = { ...VALID_REVIEW, scores: { ...VALID_REVIEW.scores, continuity: 0.75 } };
    const strict = applyGate(review, { ...DEFAULT_GATE_CONFIG, minContinuity: 0.8 });
    expect(strict.accepted).toBe(false);
    const loose = applyGate(review, { ...DEFAULT_GATE_CONFIG, minContinuity: 0.7 });
    expect(loose.accepted).toBe(true);
  });
});

// ============ E2E Workflow Tests ============

describe("P-9: Writer-Critic-Gate E2E", () => {
  let pr: InMemorySpecializedAgentProfileRegistry;
  const catalog = createP9Catalog();

  beforeEach(() => {
    pr = createP1ProfileRegistry();
  });

  it("workflow JSON loads and validates", () => {
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const issues = validateWorkflow(wf, catalog);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("scenario A: critic accepts, gate approves", async () => {
    const acceptReview = JSON.stringify({
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
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", acceptReview), catalog);
    expect(result.status).toBe("success");
    const gateRun = result.nodeRuns.find((r) => r.nodeId === "gate")!;
    const gateResult = gateRun.outputs.result as { accepted: boolean };
    expect(gateResult.accepted).toBe(true);
  });

  it("scenario B: critic revises, gate rejects", async () => {
    const reviseReview = JSON.stringify({
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
          suggestion: "Remove decision",
        },
      ],
      revisionInstruction: "Let the player decide their own action.",
    });
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", reviseReview), catalog);
    const gateRun = result.nodeRuns.find((r) => r.nodeId === "gate")!;
    const gateResult = gateRun.outputs.result as { accepted: boolean; failedChecks: string[] };
    expect(gateResult.accepted).toBe(false);
    expect(gateResult.failedChecks.length).toBeGreaterThan(0);
  });

  it("scenario C: critic says accept but playerAgency is low → gate revises", async () => {
    const badReview = JSON.stringify({
      decision: "accept",
      scores: {
        continuity: 0.9,
        characterConsistency: 0.8,
        playerAgency: 0.3,
        knowledgeBoundary: 0.9,
        styleAndFormat: 0.8,
      },
      issues: [],
    });
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", badReview), catalog);
    const gateRun = result.nodeRuns.find((r) => r.nodeId === "gate")!;
    const gateResult = gateRun.outputs.result as { accepted: boolean };
    expect(gateResult.accepted).toBe(false);
  });

  it("scenario D: error issue triggers revise even if scores pass", async () => {
    const errReview = JSON.stringify({
      decision: "accept",
      scores: {
        continuity: 0.95,
        characterConsistency: 0.95,
        playerAgency: 0.9,
        knowledgeBoundary: 0.9,
        styleAndFormat: 0.85,
      },
      issues: [
        {
          code: "knowledge-leak",
          severity: "error",
          message: "Character knows too much",
          suggestion: "Remove leaked info",
        },
      ],
    });
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", errReview), catalog);
    const gateRun = result.nodeRuns.find((r) => r.nodeId === "gate")!;
    const gateResult = gateRun.outputs.result as { accepted: boolean };
    expect(gateResult.accepted).toBe(false);
  });

  it("scenario E: illegal JSON from critic fails the workflow", async () => {
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", "not valid json"), catalog);
    // Gate should detect invalid review and fail
    const gateRun = result.nodeRuns.find((r) => r.nodeId === "gate")!;
    expect(gateRun.status).toBe("error");
  });

  it("writer output is inspectable", async () => {
    const acceptReview = JSON.stringify({
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
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(
      wf,
      createExecutors(pr, "[MOCK DRAFT]", acceptReview),
      catalog,
    );
    const inspDraft = result.nodeRuns.find((r) => r.nodeId === "inspDraft")!;
    expect(inspDraft.outputs.debug).toContain("[Text]");
    expect(inspDraft.outputs.debug).toContain("MOCK DRAFT");
  });

  it("gate result is inspectable", async () => {
    const acceptReview = JSON.stringify({
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
    const wf = loadWorkflowJson("rp-writer-critic-gate-v1.json");
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", acceptReview), catalog);
    const inspGate = result.nodeRuns.find((r) => r.nodeId === "inspGate")!;
    expect(inspGate.outputs.debug).toContain("[JSON]");
  });

  it("all nodes in production catalog", () => {
    const cat = createP9Catalog();
    expect(cat.rpCriticQualityGate).toBeDefined();
    expect(cat.rpCriticQualityGate!.type).toBe("rpCriticQualityGate");
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
    const result = await runWorkflow(wf, createExecutors(pr, "[DRAFT]", "{}"), catalog);
    expect(result.status).toBe("success");
  });
});
