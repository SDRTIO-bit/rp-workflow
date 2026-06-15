/**
 * RP Bounded Writer-Critic Revision Loop — P-10
 *
 * Implements a strictly bounded Writer → Critic → Gate → at most one revision
 * loop. Types, validators, renderers, and final result construction.
 *
 * No LLM calls. No loops. Pure deterministic logic.
 */

import type { RpCriticGateResultV1 } from "./rpCriticGate";

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

  if (revisionInstruction.length > 2000) {
    return {
      ok: false,
      error: `revisionInstruction too long: ${revisionInstruction.length} > 2000`,
    };
  }

  const failedChecks = [...gateResult.failedChecks];

  const issues = (gateResult.review.issues ?? []).map((iss) => ({
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
