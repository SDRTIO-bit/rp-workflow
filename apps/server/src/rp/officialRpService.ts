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
import { OfficialWorkflowRegistry } from "./officialWorkflowRegistry.js";
import { adaptRpInput } from "./officialRpInputAdapter.js";
import { adaptRpOutput } from "./officialRpOutputAdapter.js";
import { createRpExecutors } from "./officialRpExecutorFactory.js";

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
