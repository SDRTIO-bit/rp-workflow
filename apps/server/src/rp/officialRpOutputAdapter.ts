/**
 * P-12: Official RP Output Adapter
 *
 * Maps WorkflowRunResult → OfficialRpResponseV1.
 *
 * Responsibilities:
 *  1. Extract final narrative from output node
 *  2. Extract loop result (accepted, exhausted, attempts)
 *  3. Extract session commit status
 *  4. Extract memory commit status
 *  5. Generate traceId
 *  6. Return stable API response
 *
 * DOES NOT:
 *  - Return Draft 1 when Draft 2 is the final output
 *  - Leak internal node IDs in the response
 *  - Return Critic JSON as narrative
 *  - Mask errors as success
 */
import type { WorkflowRunResult } from "@awp/workflow-core";
import type { WorkflowRunTelemetrySummaryV1 } from "@awp/workflow-core";
import type { OfficialRpResponseV1 } from "./officialRpTypes.js";

// ── Known internal node IDs (package-private) ──
const NODE_OUTPUT = "output";
const NODE_SESSION_COMMIT = "sessionCommit";
const NODE_MEM_WRITE = "memWrite";
const NODE_MEM_POLICY = "memPolicy";
const NODE_DECISION = "decision";
const NODE_SELECTOR = "selector";

// ── Adapter ──

export function adaptRpOutput(
  result: WorkflowRunResult,
  sessionId: string,
  turnId: string,
  workflowId: string,
  workflowVersion: number,
  mode: "unified-v1" | "legacy",
  traceId: string,
  summary?: WorkflowRunTelemetrySummaryV1,
): OfficialRpResponseV1 {
  // 1. Extract narrative from designated output node
  const outputRun = result.nodeRuns.find((r) => r.nodeId === NODE_OUTPUT);
  const narrative =
    typeof outputRun?.outputs?.final === "string" ? (outputRun.outputs.final as string) : "";

  if (result.status !== "success") {
    return {
      narrative,
      sessionId,
      turnId,
      workflow: { id: workflowId, version: workflowVersion, mode },
      observability: summary ? toOfficialObservability(summary) : undefined,
      traceId,
    };
  }

  // 2. Extract loop result
  const selectorRun = result.nodeRuns.find((r) => r.nodeId === NODE_SELECTOR);
  const loopResult = selectorRun?.outputs?.loopResult as Record<string, unknown> | undefined;
  const decisionRun = result.nodeRuns.find((r) => r.nodeId === NODE_DECISION);
  const decisionOutput = decisionRun?.outputs?.decision as Record<string, unknown> | undefined;

  const qualitySource = loopResult ?? decisionOutput;
  const quality = qualitySource
    ? {
        accepted: Boolean(qualitySource.accepted),
        exhausted: Boolean(qualitySource.exhausted),
        writerAttempts: Number(qualitySource.writerAttempts ?? 1),
        criticAttempts: Number(qualitySource.criticAttempts ?? 1),
        revisionApplied: Boolean(qualitySource.revisionApplied),
      }
    : undefined;

  // 3. Extract session commit status
  const sessionCommitRun = result.nodeRuns.find((r) => r.nodeId === NODE_SESSION_COMMIT);
  const sessionCommitOutput = sessionCommitRun?.outputs?.commitResult as
    | Record<string, unknown>
    | undefined;

  const sessionCommit = sessionCommitRun
    ? {
        committed: sessionCommitRun.status === "success" || Boolean(sessionCommitOutput?.committed),
        deduplicated: Boolean(sessionCommitOutput?.deduplicated),
        conflict: Boolean(sessionCommitOutput?.conflict),
      }
    : undefined;

  // 4. Extract memory commit status
  const memWriteRun = result.nodeRuns.find((r) => r.nodeId === NODE_MEM_WRITE);
  const memPolicyRun = result.nodeRuns.find((r) => r.nodeId === NODE_MEM_POLICY);

  const memoryCommit = {
    attempted: memWriteRun !== undefined && memWriteRun.status !== "skipped",
    skipped:
      memWriteRun?.status === "skipped" ||
      memPolicyRun?.status === "skipped" ||
      memWriteRun === undefined,
    written:
      memWriteRun?.status === "success"
        ? Number((memWriteRun.outputs?.result as Record<string, unknown>)?.written ?? 1)
        : 0,
    deduplicated:
      memWriteRun?.status === "success"
        ? Boolean((memWriteRun.outputs?.result as Record<string, unknown>)?.deduplicated)
        : false,
  };

  return {
    narrative,
    sessionId,
    turnId,
    workflow: { id: workflowId, version: workflowVersion, mode },
    quality,
    sessionCommit,
    memoryCommit,
    observability: summary ? toOfficialObservability(summary) : undefined,
    traceId,
  };
}

function toOfficialObservability(summary: WorkflowRunTelemetrySummaryV1) {
  return {
    llmCalls: summary.llmCalls,
    totalLatencyMs: summary.totalLatencyMs,
    usage: summary.usage,
    roles: {
      writer: summary.byRole.writer,
      critic: summary.byRole.critic,
      memoryCurator: summary.byRole.memoryCurator,
    },
    budget: summary.budget,
    modelUsage: summary.modelUsage,
  };
}
