import type { WorkflowRunResult } from "./types.js";

export type LlmTokenUsageV1 =
  | {
      availability: "available";
      source: "provider" | "estimated";
      input: number;
      output: number;
      cachedInput?: number;
      total: number;
    }
  | {
      availability: "unavailable";
      source: "unavailable";
    };

export type LlmInvocationRoleV1 = "writer" | "critic" | "memory-curator" | "generic" | "other";

export type LlmInvocationTelemetryV1 = {
  invocationId: string;
  traceId: string;
  runId: string;
  workflowId?: string;
  workflowVersion?: number;
  nodeId: string;
  nodeType: string;
  profileId?: string;
  role: LlmInvocationRoleV1;
  attempt?: number;
  providerId?: string;
  model: string;
  startedAt: string;
  endedAt: string;
  latencyMs: number;
  status: "success" | "error";
  tokenUsage: LlmTokenUsageV1;
  finishReason?: string;
  errorCode?: string;
};

export type WorkflowRunTelemetrySummaryV1 = {
  traceId: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  totalLatencyMs: number;
  llmCalls: number;
  successfulLlmCalls: number;
  failedLlmCalls: number;
  byRole: {
    writer: number;
    critic: number;
    memoryCurator: number;
    other: number;
  };
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    unavailableInvocationCount: number;
  };
  modelUsage: Array<{
    providerId?: string;
    model: string;
    calls: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  }>;
  executedNodeCount: number;
  skippedNodeCount: number;
  failedNodeCount: number;
  budget: {
    exceeded: boolean;
    reasons: string[];
  };
};

export interface WorkflowTelemetrySink {
  recordLlmInvocation(event: LlmInvocationTelemetryV1): void | Promise<void>;
  recordRunSummary(summary: WorkflowRunTelemetrySummaryV1): void | Promise<void>;
}

export class NoopWorkflowTelemetrySink implements WorkflowTelemetrySink {
  recordLlmInvocation(_event: LlmInvocationTelemetryV1): void {
    /* noop */
  }

  recordRunSummary(_summary: WorkflowRunTelemetrySummaryV1): void {
    /* noop */
  }
}

export class InMemoryWorkflowTelemetrySink implements WorkflowTelemetrySink {
  private invocations: LlmInvocationTelemetryV1[] = [];
  private summaries: WorkflowRunTelemetrySummaryV1[] = [];

  recordLlmInvocation(event: LlmInvocationTelemetryV1): void {
    this.invocations.push(validateLlmInvocationTelemetryV1(event));
  }

  recordRunSummary(summary: WorkflowRunTelemetrySummaryV1): void {
    this.summaries.push(summary);
  }

  getLlmInvocations(runId?: string): LlmInvocationTelemetryV1[] {
    return this.invocations.filter((event) => !runId || event.runId === runId);
  }

  getRunSummaries(runId?: string): WorkflowRunTelemetrySummaryV1[] {
    return this.summaries.filter((summary) => !runId || summary.runId === runId);
  }
}

export class CompositeWorkflowTelemetrySink implements WorkflowTelemetrySink {
  constructor(private sinks: WorkflowTelemetrySink[]) {}

  async recordLlmInvocation(event: LlmInvocationTelemetryV1): Promise<void> {
    for (const sink of this.sinks) {
      await sink.recordLlmInvocation(event);
    }
  }

  async recordRunSummary(summary: WorkflowRunTelemetrySummaryV1): Promise<void> {
    for (const sink of this.sinks) {
      await sink.recordRunSummary(summary);
    }
  }
}

export function validateLlmInvocationTelemetryV1(
  event: LlmInvocationTelemetryV1,
): LlmInvocationTelemetryV1 {
  assertNonEmpty(event.invocationId, "invocationId");
  assertNonEmpty(event.traceId, "traceId");
  assertNonEmpty(event.runId, "runId");
  assertNonEmpty(event.nodeId, "nodeId");
  assertNonEmpty(event.nodeType, "nodeType");
  assertNonEmpty(event.model, "model");
  assertIso(event.startedAt, "startedAt");
  assertIso(event.endedAt, "endedAt");
  assertNonNegativeFinite(event.latencyMs, "latencyMs");
  if (event.attempt !== undefined) {
    assertNonNegativeInteger(event.attempt, "attempt");
  }
  validateTokenUsage(event.tokenUsage);
  return { ...event, tokenUsage: cloneTokenUsage(event.tokenUsage) };
}

export function buildWorkflowRunTelemetrySummaryV1(input: {
  traceId: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  invocations: LlmInvocationTelemetryV1[];
  result: WorkflowRunResult;
  budgetExceeded: boolean;
  budgetReasons: string[];
}): WorkflowRunTelemetrySummaryV1 {
  const modelMap = new Map<
    string,
    {
      providerId?: string;
      model: string;
      calls: number;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    }
  >();
  const byRole = { writer: 0, critic: 0, memoryCurator: 0, other: 0 };
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let hasKnownUsage = false;
  let unavailableInvocationCount = 0;
  let successfulLlmCalls = 0;
  let failedLlmCalls = 0;

  for (const invocation of input.invocations.map(validateLlmInvocationTelemetryV1)) {
    if (invocation.status === "success") successfulLlmCalls++;
    if (invocation.status === "error") failedLlmCalls++;

    if (invocation.role === "writer") byRole.writer++;
    else if (invocation.role === "critic") byRole.critic++;
    else if (invocation.role === "memory-curator") byRole.memoryCurator++;
    else byRole.other++;

    const modelKey = `${invocation.providerId ?? ""}\u0000${invocation.model}`;
    const modelUsage = modelMap.get(modelKey) ?? {
      providerId: invocation.providerId,
      model: invocation.model,
      calls: 0,
    };
    modelUsage.calls++;

    if (invocation.tokenUsage.availability === "available") {
      hasKnownUsage = true;
      inputTokens += invocation.tokenUsage.input;
      outputTokens += invocation.tokenUsage.output;
      totalTokens += invocation.tokenUsage.total;
      modelUsage.inputTokens = (modelUsage.inputTokens ?? 0) + invocation.tokenUsage.input;
      modelUsage.outputTokens = (modelUsage.outputTokens ?? 0) + invocation.tokenUsage.output;
      modelUsage.totalTokens = (modelUsage.totalTokens ?? 0) + invocation.tokenUsage.total;
    } else {
      unavailableInvocationCount++;
    }
    modelMap.set(modelKey, modelUsage);
  }

  const startedMs = Date.parse(input.startedAt);
  const endedMs = Date.parse(input.endedAt);

  return {
    traceId: input.traceId,
    runId: input.runId,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    totalLatencyMs: Math.max(0, endedMs - startedMs),
    llmCalls: input.invocations.length,
    successfulLlmCalls,
    failedLlmCalls,
    byRole,
    usage: {
      ...(hasKnownUsage ? { inputTokens, outputTokens, totalTokens } : {}),
      unavailableInvocationCount,
    },
    modelUsage: [...modelMap.values()].sort((a, b) => {
      const providerCompare = (a.providerId ?? "").localeCompare(b.providerId ?? "");
      return providerCompare !== 0 ? providerCompare : a.model.localeCompare(b.model);
    }),
    executedNodeCount: input.result.nodeRuns.filter((run) => run.status === "success").length,
    skippedNodeCount: input.result.nodeRuns.filter((run) => run.status === "skipped").length,
    failedNodeCount: input.result.nodeRuns.filter((run) => run.status === "error").length,
    budget: {
      exceeded: input.budgetExceeded,
      reasons: [...input.budgetReasons],
    },
  };
}

export async function safeRecordLlmInvocation(input: {
  sink: WorkflowTelemetrySink | undefined;
  event: LlmInvocationTelemetryV1;
  warnings?: string[];
  failureMode?: "warn" | "error";
}): Promise<void> {
  if (!input.sink) return;
  try {
    await input.sink.recordLlmInvocation(input.event);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.warnings?.push(`telemetry sink failed: ${message}`);
    if (input.failureMode === "error") {
      throw error;
    }
  }
}

export async function safeRecordRunSummary(input: {
  sink: WorkflowTelemetrySink | undefined;
  summary: WorkflowRunTelemetrySummaryV1;
  warnings?: string[];
  failureMode?: "warn" | "error";
}): Promise<void> {
  if (!input.sink) return;
  try {
    await input.sink.recordRunSummary(input.summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.warnings?.push(`telemetry sink failed: ${message}`);
    if (input.failureMode === "error") {
      throw error;
    }
  }
}

function validateTokenUsage(usage: LlmTokenUsageV1): void {
  if (usage.availability === "unavailable") {
    return;
  }
  assertNonNegativeInteger(usage.input, "tokenUsage.input");
  assertNonNegativeInteger(usage.output, "tokenUsage.output");
  assertNonNegativeInteger(usage.total, "tokenUsage.total");
  if (usage.cachedInput !== undefined) {
    assertNonNegativeInteger(usage.cachedInput, "tokenUsage.cachedInput");
  }
  if (usage.total !== usage.input + usage.output) {
    throw new Error("tokenUsage.total must equal input + output");
  }
}

function cloneTokenUsage(usage: LlmTokenUsageV1): LlmTokenUsageV1 {
  return usage.availability === "available" ? { ...usage } : { ...usage };
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function assertIso(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO date string`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  assertNonNegativeFinite(value, field);
  if (!Number.isInteger(value)) {
    throw new Error(`${field} must be an integer`);
  }
}

function assertNonNegativeFinite(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite number`);
  }
}
