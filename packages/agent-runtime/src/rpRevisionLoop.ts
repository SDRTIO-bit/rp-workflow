/**
 * RP Bounded Writer-Critic Revision Loop — P-10
 *
 * Implements a strictly bounded Writer → Critic → Gate → at most one revision
 * loop. Types, validators, renderers, and final result construction.
 *
 * No LLM calls. No loops. Pure deterministic logic.
 */

import type { RpCriticGateResultV1 } from "./rpCriticGate.js";

// ============ Constants ============

export const MAX_WRITER_ATTEMPTS = 2;
export const MAX_CRITIC_ATTEMPTS = 2;
export const MAX_REVISIONS = 1;

export const RP_REVISION_REQUEST_SCHEMA = "awp.rp-revision-request.v1";
export const RP_REVISION_LOOP_RESULT_SCHEMA = "awp.rp-revision-loop-result.v1";

// ============ Revision Request ============

export type RpRevisionRequestV1 = {
  attempt: 2;
  originalDraft: string;
  revisionInstruction: string;
  failedChecks: string[];
  issues: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
    suggestion: string;
  }>;
};

/**
 * Validate and construct a RevisionRequest from a gate result and draft.
 * Returns the validated request or an error.
 */
export function createRevisionRequest(
  gateResult: RpCriticGateResultV1,
  originalDraft: string,
): { ok: true; request: RpRevisionRequestV1 } | { ok: false; error: string } {
  if (!originalDraft || typeof originalDraft !== "string" || !originalDraft.trim()) {
    return { ok: false, error: "originalDraft must be a non-empty string" };
  }

  const revisionInstruction = gateResult.revisionInstruction;
  if (
    !revisionInstruction ||
    typeof revisionInstruction !== "string" ||
    !revisionInstruction.trim()
  ) {
    return { ok: false, error: "revisionInstruction must be a non-empty string" };
  }

  if (revisionInstruction.length > 1000) {
    return {
      ok: false,
      error: `revisionInstruction too long: ${revisionInstruction.length} > 1000`,
    };
  }

  const failedChecks = [...gateResult.failedChecks];

  // Prioritize issues: all errors + max 2 high-priority warnings
  const allIssues = gateResult.review.issues ?? [];
  const errors = allIssues.filter((iss) => iss.severity === "error");
  const warnings = allIssues.filter((iss) => iss.severity === "warning");

  // Take all errors + up to 2 warnings (prioritize player-agency, knowledge-leak, continuity)
  const priorityOrder = [
    "player-agency",
    "knowledge-leak",
    "continuity",
    "character-inconsistency",
    "worldbook-conflict",
    "format",
    "repetition",
    "style",
    "other",
  ];

  const sortedWarnings = [...warnings].sort((a, b) => {
    const ai = priorityOrder.indexOf(a.code);
    const bi = priorityOrder.indexOf(b.code);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const prioritizedIssues = [...errors, ...sortedWarnings.slice(0, 2)];

  const issues = prioritizedIssues.map((iss) => ({
    code: iss.code,
    severity: iss.severity,
    message: iss.message.slice(0, 500),
    suggestion: iss.suggestion.slice(0, 500),
  }));

  if (issues.length > 20) {
    return { ok: false, error: `too many issues: ${issues.length} > 20` };
  }

  return {
    ok: true,
    request: {
      attempt: 2,
      originalDraft: originalDraft.trim(),
      revisionInstruction: revisionInstruction.trim(),
      failedChecks,
      issues,
    },
  };
}

// ============ Revision Prompt Renderer ============

/**
 * Deterministic renderer that builds the Writer 2 prompt from a revision request
 * and original context. Does NOT call LLM. Produces a markdown string suitable
 * for the specializedAgent "instruction" port.
 *
 * Only passes necessary fields — no raw Critic JSON, no secrets, no internal objects.
 */
export function renderRevisionPrompt(
  request: RpRevisionRequestV1,
  playerInput: string,
  contextMarkdown?: string,
): string {
  const sections: string[] = [];

  sections.push("## Original Player Input");
  sections.push(playerInput);

  if (contextMarkdown) {
    sections.push("## Relevant Context");
    sections.push(contextMarkdown);
  }

  sections.push("## Original Draft");
  sections.push(request.originalDraft);

  sections.push("## Critic Revision Instruction");
  sections.push(request.revisionInstruction);

  if (request.issues.length > 0) {
    sections.push("## Issues to Correct");
    for (const issue of request.issues) {
      const prefix = issue.severity === "error" ? "[ERROR]" : "[WARNING]";
      sections.push(`${prefix} ${issue.message} → ${issue.suggestion}`);
    }
  }

  sections.push("## Revision Rules");
  sections.push(
    [
      "- Preserve all parts of the original draft that were NOT flagged as issues.",
      "- Only fix the explicitly identified problems.",
      "- Do NOT output explanations, analysis, or meta-commentary.",
      "- Do NOT reference the Critic or the review process.",
      "- Do NOT output labels like 'Revised Version' or 'Revision'.",
      "- Maintain the RP Writer profile requirements.",
      "- Do NOT add key actions or decisions for the player character.",
      "- Output ONLY the complete revised narrative text.",
    ].join("\n"),
  );

  return sections.join("\n\n");
}

// ============ Revision Finalize Config ============

export type RpRevisionFinalizeConfig = {
  onExhausted: "fail" | "return-latest";
};

export const DEFAULT_FINALIZE_CONFIG: RpRevisionFinalizeConfig = {
  onExhausted: "return-latest",
};

// ============ Loop Result ============

export type RpRevisionLoopResultV1 = {
  finalDraft: string;

  accepted: boolean;
  exhausted: boolean;

  writerAttempts: 1 | 2;
  criticAttempts: 1 | 2;

  finalDraftSource: "attempt-1" | "attempt-2";

  gateResult: RpCriticGateResultV1;
  firstGateResult: RpCriticGateResultV1;

  revisionApplied: boolean;
};

/**
 * Build the final loop result for the first-pass accept scenario.
 */
export function buildFirstPassResult(
  draft1: string,
  gateResult: RpCriticGateResultV1,
): RpRevisionLoopResultV1 {
  return {
    finalDraft: draft1,
    accepted: true,
    exhausted: false,
    writerAttempts: 1,
    criticAttempts: 1,
    finalDraftSource: "attempt-1",
    gateResult,
    firstGateResult: gateResult,
    revisionApplied: false,
  };
}

/**
 * Build the final loop result for the revision-pass accept scenario.
 */
export function buildRevisionPassResult(
  draft2: string,
  firstGateResult: RpCriticGateResultV1,
  secondGateResult: RpCriticGateResultV1,
): RpRevisionLoopResultV1 {
  return {
    finalDraft: draft2,
    accepted: true,
    exhausted: false,
    writerAttempts: 2,
    criticAttempts: 2,
    finalDraftSource: "attempt-2",
    gateResult: secondGateResult,
    firstGateResult,
    revisionApplied: true,
  };
}

/**
 * Build the final loop result for the exhausted scenario.
 */
export function buildExhaustedResult(
  draft2: string,
  firstGateResult: RpCriticGateResultV1,
  secondGateResult: RpCriticGateResultV1,
): RpRevisionLoopResultV1 {
  return {
    finalDraft: draft2,
    accepted: false,
    exhausted: true,
    writerAttempts: 2,
    criticAttempts: 2,
    finalDraftSource: "attempt-2",
    gateResult: secondGateResult,
    firstGateResult,
    revisionApplied: true,
  };
}

/**
 * Validate the consistency of a loop result.
 * Returns the first inconsistency or null if valid.
 */
export function validateLoopResult(result: RpRevisionLoopResultV1): string | null {
  if (result.accepted && result.exhausted) {
    return "cannot be both accepted and exhausted";
  }

  if (result.finalDraftSource === "attempt-1") {
    if (result.writerAttempts !== 1) {
      return "attempt-1 source requires writerAttempts=1";
    }
    if (result.criticAttempts !== 1) {
      return "attempt-1 source requires criticAttempts=1";
    }
    if (result.revisionApplied) {
      return "attempt-1 source cannot have revisionApplied=true";
    }
    if (result.exhausted) {
      return "attempt-1 source cannot be exhausted";
    }
  }

  if (result.finalDraftSource === "attempt-2") {
    if (result.writerAttempts !== 2) {
      return "attempt-2 source requires writerAttempts=2";
    }
    if (result.criticAttempts !== 2) {
      return "attempt-2 source requires criticAttempts=2";
    }
    if (!result.revisionApplied) {
      return "attempt-2 source requires revisionApplied=true";
    }
  }

  if (result.finalDraftSource === "attempt-1" && !result.accepted) {
    return "attempt-1 source must have accepted=true";
  }

  return null;
}

// ============ P-11.1: Side-Effect Decision ============

/**
 * Deterministic side-effect decision derived from a revision loop result.
 * Does NOT call LLM, access Store, or modify the loop result.
 *
 * Schema ID: awp.rp-side-effect-decision.v1
 */
export type RpSideEffectDecisionV1 = {
  allowPlayerOutput: boolean;
  allowSessionCommit: boolean;
  allowMemoryCommit: boolean;

  accepted: boolean;
  exhausted: boolean;

  reason: "accepted" | "exhausted-return-latest" | "exhausted-fail";
};

/**
 * Compute the side-effect decision from a loop result and finalize config.
 *
 * Rules:
 * - accepted=true → all allowed, reason=accepted
 * - accepted=false + exhausted=true + onExhausted=return-latest →
 *   player/session allowed, memory denied, reason=exhausted-return-latest
 * - accepted=false + exhausted=true + onExhausted=fail →
 *   all denied, reason=exhausted-fail
 *
 * Throws for illegal state combinations.
 */
export function computeSideEffectDecision(
  loopResult: RpRevisionLoopResultV1,
  config: RpRevisionFinalizeConfig = DEFAULT_FINALIZE_CONFIG,
): RpSideEffectDecisionV1 {
  const validationError = validateLoopResult(loopResult);
  if (validationError) {
    throw new Error(`rpSideEffectDecision: invalid loop result: ${validationError}`);
  }

  if (loopResult.accepted) {
    return {
      allowPlayerOutput: true,
      allowSessionCommit: true,
      allowMemoryCommit: true,
      accepted: true,
      exhausted: false,
      reason: "accepted",
    };
  }

  // Not accepted → must be exhausted (validated above)
  if (!loopResult.exhausted) {
    throw new Error(
      "rpSideEffectDecision: loop result is neither accepted nor exhausted — illegal state",
    );
  }

  if (config.onExhausted === "return-latest") {
    return {
      allowPlayerOutput: true,
      allowSessionCommit: true,
      allowMemoryCommit: false,
      accepted: false,
      exhausted: true,
      reason: "exhausted-return-latest",
    };
  }

  // Must be fail
  if (config.onExhausted === "fail") {
    return {
      allowPlayerOutput: false,
      allowSessionCommit: false,
      allowMemoryCommit: false,
      accepted: false,
      exhausted: true,
      reason: "exhausted-fail",
    };
  }

  throw new Error(
    `rpSideEffectDecision: unknown onExhausted value "${String(config.onExhausted)}"`,
  );
}
