/**
 * P-12: Official RP Service
 *
 * Single entry point for running an official RP turn.
 *
 * Responsibilities:
 *  - Select workflow (unified-v1 or legacy)
 *  - Load workflow from Registry
 *  - Adapt input → workflow + context
 *  - Run via Branch-aware Runner
 *  - Adapt output → API response
 *
 * DOES NOT:
 *  - Handle HTTP concerns (routes do that)
 *  - Hardcode file paths
 *  - Create test-only executors
 */
import {
  CompositeWorkflowTelemetrySink,
  InMemoryWorkflowTelemetrySink,
  WorkflowUsageBudgetController,
  buildWorkflowRunTelemetrySummaryV1,
  safeRecordRunSummary,
  validateWorkflow,
  runWorkflowWithBranches,
  type WorkflowRunTelemetrySummaryV1,
} from "@awp/workflow-core";
import type {
  OfficialRpRequestV1,
  OfficialRpResponseV1,
  OfficialRpServiceContext,
} from "./officialRpTypes.js";
import { readEntries } from "../services/jsonStore.js";
import { OfficialWorkflowRegistry } from "./officialWorkflowRegistry.js";
import { adaptRpInput } from "./officialRpInputAdapter.js";
import { adaptRpOutput } from "./officialRpOutputAdapter.js";
import { createRpExecutors } from "./officialRpExecutorFactory.js";

/**
 * Error thrown by the card-aware worldbook seeding path. Carries an
 * explicit HTTP status code so the RP route can map it without
 * fragile string matching. P-15.3A-2.1.
 */
export class CardWorldbookError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 422 | 500,
    public readonly code:
      | "invalid-card-resource"
      | "card-not-found"
      | "card-corrupt"
      | "card-store-missing",
  ) {
    super(message);
    this.name = "CardWorldbookError";
  }
}

export class OfficialRpService {
  private registry: OfficialWorkflowRegistry;
  private ctx: OfficialRpServiceContext;

  constructor(ctx: OfficialRpServiceContext) {
    this.ctx = ctx;
    this.registry = new OfficialWorkflowRegistry(ctx.dataDir);
  }

  /**
   * Run an official RP turn.
   *
   * @throws on validation failure, missing workflow, or runtime errors
   */
  async runTurn(request: OfficialRpRequestV1): Promise<OfficialRpResponseV1> {
    const traceId = createTraceId();
    const runId = createRunId();

    // 1. Resolve workflow version
    const mode = request.workflowVersion ?? this.ctx.serverWorkflowVersion;
    if (!["unified-v1", "legacy"].includes(mode)) {
      throw new Error(`Unsupported workflow version: "${mode}"`);
    }

    // 2. Legacy fallback
    if (mode === "legacy") {
      return this.runLegacyTurn(request, traceId, runId);
    }

    // 3. Unified path
    return this.runUnifiedTurn(request, traceId, runId);
  }

  private async runUnifiedTurn(
    request: OfficialRpRequestV1,
    traceId: string,
    runId: string,
  ): Promise<OfficialRpResponseV1> {
    // Load workflow from registry
    const entry = this.registry.getStableRpDefault();
    const workflow = this.registry.loadWorkflow(entry);

    // Validate
    const validationIssues = validateWorkflow(workflow, this.ctx.runtimeNodeCatalog);
    const errors = validationIssues.filter((i) => i.level === "error");
    if (errors.length > 0) {
      throw new Error(`Workflow validation failed: ${errors.map((e) => e.message).join("; ")}`);
    }

    // Adapt input
    const { workflow: adaptedWf, context } = adaptRpInput(request, workflow);
    await seedSessionWorldbookIfEmpty(this.ctx, request);
    const localSink = new InMemoryWorkflowTelemetrySink();
    const telemetryWarnings: string[] = [];
    const sink = this.ctx.telemetrySink
      ? new CompositeWorkflowTelemetrySink([localSink, this.ctx.telemetrySink])
      : localSink;
    const usageBudgetController = request.usageBudget
      ? new WorkflowUsageBudgetController(request.usageBudget)
      : undefined;
    const runStartedAt = new Date().toISOString();
    const workflowContext = {
      ...context,
      runId,
      traceId,
      telemetrySink: sink,
      telemetryWarnings,
      usageBudgetController,
      values: {
        ...(context.values ?? {}),
        workflowId: entry.id,
        workflowVersion: entry.version,
      },
    };

    // Create executors
    const executors = createRpExecutors(this.ctx, request);

    // Run with branch-aware runner
    const result = await runWorkflowWithBranches(
      adaptedWf,
      executors,
      this.ctx.runtimeNodeCatalog,
      workflowContext,
    );
    const runEndedAt = new Date().toISOString();
    const budgetState = usageBudgetController?.getState();
    const summary = buildWorkflowRunTelemetrySummaryV1({
      traceId,
      runId,
      startedAt: runStartedAt,
      endedAt: runEndedAt,
      invocations: localSink.getLlmInvocations(runId),
      result,
      budgetExceeded: budgetState?.exceeded ?? false,
      budgetReasons: budgetState?.exceededReasons ?? [],
    });
    await safeRecordRunSummary({ sink, summary, warnings: telemetryWarnings });

    if (result.status !== "success") {
      logOfficialRpFailure(traceId, summary, result);
      const failed = result.nodeRuns.find((run) => run.status === "error");
      throw new Error(failed?.error ?? "Official RP workflow failed");
    }

    // Adapt output
    const response = adaptRpOutput(
      result,
      request.sessionId,
      request.turnId,
      entry.id,
      entry.version,
      "unified-v1",
      traceId,
      summary,
    );
    logOfficialRpCompletion(traceId, summary, response);
    return response;
  }

  private async runLegacyTurn(
    request: OfficialRpRequestV1,
    traceId: string,
    runId: string,
  ): Promise<OfficialRpResponseV1> {
    // If a legacy executor is configured, use it
    if (this.ctx.legacyRpExecutor) {
      const response = await this.ctx.legacyRpExecutor(request);
      return { ...response, traceId: response.traceId || traceId };
    }

    // Otherwise run the legacy workflow through the branch-aware runner
    const entry = this.registry.getLegacyRp();
    const workflow = this.registry.loadWorkflow(entry);

    // Adapt input (reuse same adapter — sets playerInput text, etc.)
    const { workflow: adaptedWf, context } = adaptRpInput(request, workflow);
    const workflowContext = {
      ...context,
      runId,
      traceId,
      values: {
        ...(context.values ?? {}),
        workflowId: entry.id,
        workflowVersion: entry.version,
      },
    };

    const executors = createRpExecutors(this.ctx, request);

    const result = await runWorkflowWithBranches(
      adaptedWf,
      executors,
      this.ctx.runtimeNodeCatalog,
      workflowContext,
    );

    return adaptRpOutput(
      result,
      request.sessionId,
      request.turnId,
      entry.id,
      entry.version,
      "legacy",
      traceId,
    );
  }

  /** Expose registry for testing */
  getRegistry(): OfficialWorkflowRegistry {
    return this.registry;
  }
}

async function seedSessionWorldbookIfEmpty(
  ctx: OfficialRpServiceContext,
  request: OfficialRpRequestV1,
): Promise<void> {
  const resourceRef = request.worldbook.resourceRef;
  const scopeKey = `session:${request.sessionId}:${resourceRef}`;

  // Idempotent: never re-seed a scope that already has content.
  const existing = await ctx.worldbookStore.load(scopeKey, resourceRef);
  if (existing.entries.length > 0) return;

  // Card-aware path: resourceRef starts with "card:" → seed from the Card's
  // on-disk worldbook.json (P-15.3A-2). Falls back to global default if the
  // card is unavailable, but ONLY for non-card resourceRefs.
  if (resourceRef.startsWith("card:")) {
    await seedCardWorldbook(ctx, resourceRef, scopeKey);
    return;
  }

  // Default path: read the global data/worldbook.json. Unchanged from P-12.
  const entries = await readEntries(`${ctx.dataDir}/worldbook.json`);
  if (entries.length === 0) return;

  await ctx.worldbookStore.save(scopeKey, resourceRef, {
    version: 1,
    entries: entries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      tags: entry.tags,
      type: "world",
      priority: 50,
      updatedAt: entry.updatedAt,
    })),
  });
}

/**
 * Seed the session's DynamicWorldbookStore from a Card's on-disk
 * worldbook.json (P-15.3A-2).
 *
 * Steps:
 *  1. Strictly extract the 64-hex cardId from the resourceRef.
 *  2. Verify FileCardStore is available; refuse if not.
 *  3. Verify the Card exists and its source.json hash is intact.
 *  4. Read the Card's `worldbook.json` (already partitioned by the
 *     A-1 worldbook mapper into active entries only; deferred-variable
 *     and blocked-script entries are stored in `deferred-worldbook.json`
 *     and are NOT loaded here).
 *  5. Verify source integrity (sha256 of source.json matches cardId).
 *  6. Persist active entries to the session scope.
 *
 * Behavior:
 *  - Already populated: no-op (checked by caller).
 *  - Card not found / corrupt: throw, refusing to fall back to the global
 *    worldbook. The spec explicitly forbids silent fallback to
 *    `data/worldbook.json` for `card:` resourceRefs.
 *  - Two sessions or two cards never share seeded state: scopeKey includes
 *    both sessionId and resourceRef.
 *  - Restart recovery: if the InMemory store is empty but the Card file
 *    still exists, re-seeding is automatic on the next /api/rp call.
 */
async function seedCardWorldbook(
  ctx: OfficialRpServiceContext,
  resourceRef: string,
  scopeKey: string,
): Promise<void> {
  const cardId = resourceRef.slice("card:".length);
  if (!/^[0-9a-f]{64}$/.test(cardId)) {
    throw new CardWorldbookError(
      `Invalid card resourceRef: "${resourceRef}" (expected 64-hex cardId after "card:")`,
      400,
      "invalid-card-resource",
    );
  }

  if (!ctx.cardStore) {
    throw new CardWorldbookError(
      `card resourceRef "${resourceRef}" requires a configured FileCardStore`,
      500,
      "card-store-missing",
    );
  }

  // Verify the Card exists AND its source.json hash is intact.
  const exists = await ctx.cardStore.hasCard(cardId);
  if (!exists) {
    throw new CardWorldbookError(
      `Card not found for resourceRef "${resourceRef}" (cardId=${cardId})`,
      404,
      "card-not-found",
    );
  }
  const sourceIntact = await ctx.cardStore.verifySourceIntegrity(cardId);
  if (!sourceIntact) {
    throw new CardWorldbookError(
      `Card source.json integrity check failed for cardId=${cardId} (refusing to seed)`,
      422,
      "card-corrupt",
    );
  }

  // Read the Card's partitioned worldbook. The A-1 mapper already
  // excludes disabled / deferred-variable / blocked-script entries; those
  // live in `deferred-worldbook.json` and are NOT loaded here.
  let cardEntry;
  try {
    cardEntry = await ctx.cardStore.readCard(cardId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new CardWorldbookError(
      `Card read failed for cardId=${cardId}: ${message}`,
      422,
      "card-corrupt",
    );
  }
  if (cardEntry.worldbook.length === 0) return;

  await ctx.worldbookStore.save(scopeKey, resourceRef, {
    version: 1,
    entries: cardEntry.worldbook.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      tags: entry.tags ?? [],
      type: entry.type ?? "world",
      priority: entry.priority ?? 50,
      metadata: entry.metadata ?? null,
    })),
  });
}

function createTraceId(): string {
  return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function createRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function logOfficialRpCompletion(
  traceId: string,
  summary: WorkflowRunTelemetrySummaryV1,
  response: OfficialRpResponseV1,
): void {
  console.log(
    JSON.stringify({
      event: "official_rp_turn_completed",
      traceId,
      workflow: response.workflow.id,
      llmCalls: summary.llmCalls,
      writerAttempts: response.quality?.writerAttempts ?? 0,
      criticAttempts: response.quality?.criticAttempts ?? 0,
      memoryCuratorCalls: summary.byRole.memoryCurator,
      latencyMs: summary.totalLatencyMs,
      totalTokens: summary.usage.totalTokens,
      usageUnavailable: summary.usage.unavailableInvocationCount,
      accepted: response.quality?.accepted ?? false,
      exhausted: response.quality?.exhausted ?? false,
      memoryWritten: response.memoryCommit?.written ?? 0,
    }),
  );
}

function logOfficialRpFailure(
  traceId: string,
  summary: WorkflowRunTelemetrySummaryV1,
  result: { nodeRuns: Array<{ status: string; nodeId: string; error?: string }> },
): void {
  const failed = result.nodeRuns.find((run) => run.status === "error");
  console.log(
    JSON.stringify({
      event: "official_rp_turn_failed",
      traceId,
      errorCode: "WORKFLOW_FAILED",
      failedNodeId: failed?.nodeId,
      llmCalls: summary.llmCalls,
      latencyMs: summary.totalLatencyMs,
    }),
  );
}
