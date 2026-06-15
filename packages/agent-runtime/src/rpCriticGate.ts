/**
 * RP Critic Review Schema & Quality Gate — P-9
 *
 * Defines the structured review contract and a deterministic quality gate
 * that produces an accept/revise decision based on score thresholds.
 */
import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";

// ============ Review Schema ============

export type RpCriticReviewV1 = {
  decision: "accept" | "revise";
  scores: {
    continuity: number;
    characterConsistency: number;
    playerAgency: number;
    knowledgeBoundary: number;
    styleAndFormat: number;
  };
  issues: Array<{
    code:
      | "continuity"
      | "character-inconsistency"
      | "player-agency"
      | "knowledge-leak"
      | "worldbook-conflict"
      | "format"
      | "style"
      | "repetition"
      | "other";
    severity: "warning" | "error";
    message: string;
    evidence?: string;
    suggestion: string;
  }>;
  revisionInstruction?: string;
};

export const RP_CRITIC_REVIEW_SCHEMA = "awp.rp-critic-review.v1";

// ============ Gate Config ============

export type RpCriticQualityGateConfig = {
  minContinuity: number;
  minCharacterConsistency: number;
  minPlayerAgency: number;
  minKnowledgeBoundary: number;
  minStyleAndFormat: number;
  rejectOnErrorIssue: boolean;
};

export const DEFAULT_GATE_CONFIG: RpCriticQualityGateConfig = {
  minContinuity: 0.7,
  minCharacterConsistency: 0.7,
  minPlayerAgency: 0.8,
  minKnowledgeBoundary: 0.8,
  minStyleAndFormat: 0.65,
  rejectOnErrorIssue: true,
};

// ============ Gate Result ============

export type RpCriticGateResultV1 = {
  accepted: boolean;
  decision: "accept" | "revise";
  failedChecks: string[];
  revisionInstruction?: string;
  review: RpCriticReviewV1;
};

// ============ Schema Validation ============

const VALID_CODES = new Set([
  "continuity",
  "character-inconsistency",
  "player-agency",
  "knowledge-leak",
  "worldbook-conflict",
  "format",
  "style",
  "repetition",
  "other",
]);

export function validateReviewSchema(
  data: unknown,
): { ok: true; review: RpCriticReviewV1 } | { ok: false; error: string } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, error: "review must be a JSON object" };
  }
  const r = data as Record<string, unknown>;

  if (r.decision !== "accept" && r.decision !== "revise") {
    return { ok: false, error: "decision must be 'accept' or 'revise'" };
  }

  const scores = r.scores as Record<string, unknown> | undefined;
  if (!scores || typeof scores !== "object") {
    return { ok: false, error: "scores must be a non-null object" };
  }
  const scoreKeys = [
    "continuity",
    "characterConsistency",
    "playerAgency",
    "knowledgeBoundary",
    "styleAndFormat",
  ];
  for (const k of scoreKeys) {
    const v = scores[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) {
      return { ok: false, error: `scores.${k} must be a finite number 0-1, got ${v}` };
    }
  }

  if (!Array.isArray(r.issues)) {
    return { ok: false, error: "issues must be an array" };
  }

  for (let i = 0; i < r.issues.length; i++) {
    const iss = r.issues[i] as Record<string, unknown> | undefined;
    if (!iss || typeof iss !== "object") {
      return { ok: false, error: `issues[${i}] must be an object` };
    }
    if (typeof iss.code !== "string" || !VALID_CODES.has(iss.code)) {
      return { ok: false, error: `issues[${i}].code invalid: "${String(iss.code)}"` };
    }
    if (iss.severity !== "warning" && iss.severity !== "error") {
      return { ok: false, error: `issues[${i}].severity must be 'warning' or 'error'` };
    }
    if (typeof iss.message !== "string" || !iss.message.trim()) {
      return { ok: false, error: `issues[${i}].message must be non-empty string` };
    }
    if (typeof iss.suggestion !== "string" || !iss.suggestion.trim()) {
      return { ok: false, error: `issues[${i}].suggestion must be non-empty string` };
    }
    if (iss.evidence !== undefined && typeof iss.evidence !== "string") {
      return { ok: false, error: `issues[${i}].evidence must be a string if present` };
    }
  }

  if (
    r.decision === "revise" &&
    (!r.revisionInstruction ||
      typeof r.revisionInstruction !== "string" ||
      !r.revisionInstruction.trim())
  ) {
    return { ok: false, error: "revisionInstruction is required when decision is 'revise'" };
  }

  return {
    ok: true,
    review: {
      decision: r.decision as "accept" | "revise",
      scores: {
        continuity: scores.continuity as number,
        characterConsistency: scores.characterConsistency as number,
        playerAgency: scores.playerAgency as number,
        knowledgeBoundary: scores.knowledgeBoundary as number,
        styleAndFormat: scores.styleAndFormat as number,
      },
      issues: (r.issues as Array<Record<string, unknown>>).map((iss) => ({
        code: iss.code as RpCriticReviewV1["issues"][number]["code"],
        severity: iss.severity as "warning" | "error",
        message: String(iss.message),
        evidence: typeof iss.evidence === "string" ? iss.evidence : undefined,
        suggestion: String(iss.suggestion),
      })),
      revisionInstruction:
        typeof r.revisionInstruction === "string" ? r.revisionInstruction : undefined,
    },
  };
}

// ============ Quality Gate Logic ============

export function applyGate(
  review: RpCriticReviewV1,
  config: RpCriticQualityGateConfig = DEFAULT_GATE_CONFIG,
): RpCriticGateResultV1 {
  const failedChecks: string[] = [];
  const reasonOrder = [
    "continuity",
    "characterConsistency",
    "playerAgency",
    "knowledgeBoundary",
    "styleAndFormat",
  ];

  // Score thresholds
  const thresholds: Array<{ key: string; score: number; threshold: number }> = [
    { key: "continuity", score: review.scores.continuity, threshold: config.minContinuity },
    {
      key: "characterConsistency",
      score: review.scores.characterConsistency,
      threshold: config.minCharacterConsistency,
    },
    { key: "playerAgency", score: review.scores.playerAgency, threshold: config.minPlayerAgency },
    {
      key: "knowledgeBoundary",
      score: review.scores.knowledgeBoundary,
      threshold: config.minKnowledgeBoundary,
    },
    {
      key: "styleAndFormat",
      score: review.scores.styleAndFormat,
      threshold: config.minStyleAndFormat,
    },
  ];

  for (const t of thresholds) {
    if (t.score < t.threshold) {
      failedChecks.push(`${t.key}: ${t.score} < ${t.threshold}`);
    }
  }

  // Error issues
  if (config.rejectOnErrorIssue && review.issues.some((i) => i.severity === "error")) {
    failedChecks.push("has-error-issue");
  }

  // Critic decision
  if (review.decision === "revise") {
    failedChecks.push("critic-decision: revise");
  }

  const accepted = failedChecks.length === 0;

  return {
    accepted,
    decision: accepted ? "accept" : "revise",
    failedChecks: [...new Set(failedChecks)].sort((a, b) => {
      const ai = reasonOrder.findIndex((k) => a.startsWith(k));
      const bi = reasonOrder.findIndex((k) => b.startsWith(k));
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    }),
    revisionInstruction: accepted ? undefined : review.revisionInstruction,
    review,
  };
}

// ============ Node Definition ============

export const rpCriticQualityGateNode: NodeDefinition = {
  type: "rpCriticQualityGate",
  label: "RP Critic Quality Gate",
  labelI18n: { zh: "RP 审查质量门", en: "RP Critic Quality Gate" },
  category: "utility",
  description:
    "Deterministic quality gate: applies score thresholds and error checks to a critic review, producing accept/revise decision.",
  descriptionI18n: {
    zh: "确定性质量门：对审查结果应用分数阈值和错误检查，产生 accept/revise 决定。",
    en: "Deterministic quality gate: applies score thresholds and error checks to a critic review, producing accept/revise decision.",
  },
  color: "#f59e0b",
  panelLayout: "generic",
  defaultConfig: { ...DEFAULT_GATE_CONFIG },
  configFields: [
    {
      key: "minContinuity",
      label: { zh: "最低连贯性", en: "Min Continuity" },
      kind: "number",
      min: 0,
      max: 1,
      advanced: true,
    },
    {
      key: "minCharacterConsistency",
      label: { zh: "最低角色一致性", en: "Min Character Consistency" },
      kind: "number",
      min: 0,
      max: 1,
      advanced: true,
    },
    {
      key: "minPlayerAgency",
      label: { zh: "最低玩家代理权", en: "Min Player Agency" },
      kind: "number",
      min: 0,
      max: 1,
      advanced: true,
    },
    {
      key: "minKnowledgeBoundary",
      label: { zh: "最低知识边界", en: "Min Knowledge Boundary" },
      kind: "number",
      min: 0,
      max: 1,
      advanced: true,
    },
    {
      key: "minStyleAndFormat",
      label: { zh: "最低风格格式", en: "Min Style & Format" },
      kind: "number",
      min: 0,
      max: 1,
      advanced: true,
    },
    {
      key: "rejectOnErrorIssue",
      label: { zh: "Error Issue 时拒绝", en: "Reject on Error Issue" },
      kind: "boolean",
    },
  ],
  ports: [
    { id: "review", label: "Review", direction: "input", wireType: "text", required: true },
    { id: "result", label: "Result", direction: "output", wireType: "json" },
  ],
};

// ============ Executor ============

export const rpCriticQualityGateExecutor: NodeExecutor = async (input: NodeExecutionInput) => {
  const node = input.node;
  const config = { ...DEFAULT_GATE_CONFIG, ...(node.config as Partial<RpCriticQualityGateConfig>) };
  const inputs = input.inputs as Record<string, unknown>;

  const raw = inputs.review;
  if (!raw) {
    throw new Error("rpCriticQualityGate: review input is required");
  }

  // Parse text input as JSON (critic outputs plain text with JSON content)
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `rpCriticQualityGate: failed to parse critic output as JSON: ${(e as Error).message}`,
      );
    }
  } else {
    parsed = raw;
  }

  const validation = validateReviewSchema(parsed);
  if (!validation.ok) {
    throw new Error(`rpCriticQualityGate: invalid review schema: ${validation.error}`);
  }

  const result = applyGate(validation.review, config);

  return {
    outputs: { result },
    metadata: {
      accepted: result.accepted,
      failedChecks: result.failedChecks.length,
      decision: result.decision,
    },
  };
};
