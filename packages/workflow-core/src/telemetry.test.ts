import { describe, expect, it } from "vitest";
import {
  InMemoryWorkflowTelemetrySink,
  NoopWorkflowTelemetrySink,
  buildWorkflowRunTelemetrySummaryV1,
  validateLlmInvocationTelemetryV1,
  type LlmInvocationTelemetryV1,
} from "./telemetry.js";
import type { WorkflowRunResult } from "./types.js";

const baseInvocation = (): LlmInvocationTelemetryV1 => ({
  invocationId: "inv-1",
  traceId: "trace-1",
  runId: "run-1",
  workflowId: "wf",
  workflowVersion: 1,
  nodeId: "writer1",
  nodeType: "specializedAgent",
  profileId: "rp-writer",
  role: "writer",
  attempt: 1,
  providerId: "mock",
  model: "mock-model",
  startedAt: "2026-06-16T00:00:00.000Z",
  endedAt: "2026-06-16T00:00:00.010Z",
  latencyMs: 10,
  status: "success",
  tokenUsage: {
    availability: "available",
    source: "provider",
    input: 11,
    output: 7,
    cachedInput: 3,
    total: 18,
  },
});

describe("P-13A telemetry schema", () => {
  it("accepts a valid invocation without mutating input", () => {
    const invocation = baseInvocation();
    const before = JSON.stringify(invocation);

    expect(validateLlmInvocationTelemetryV1(invocation)).toEqual(invocation);
    expect(JSON.stringify(invocation)).toBe(before);
  });

  it("rejects negative and non-finite latency", () => {
    expect(() => validateLlmInvocationTelemetryV1({ ...baseInvocation(), latencyMs: -1 })).toThrow(
      "latencyMs",
    );
    expect(() =>
      validateLlmInvocationTelemetryV1({
        ...baseInvocation(),
        latencyMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow("latencyMs");
  });

  it("rejects negative and inconsistent token usage", () => {
    expect(() =>
      validateLlmInvocationTelemetryV1({
        ...baseInvocation(),
        tokenUsage: {
          availability: "available",
          source: "provider",
          input: -1,
          output: 1,
          total: 0,
        },
      }),
    ).toThrow("token");

    expect(() =>
      validateLlmInvocationTelemetryV1({
        ...baseInvocation(),
        tokenUsage: {
          availability: "available",
          source: "provider",
          input: 2,
          output: 3,
          total: 99,
        },
      }),
    ).toThrow("total");
  });

  it("accepts usage unavailable without total", () => {
    const invocation = {
      ...baseInvocation(),
      tokenUsage: { availability: "unavailable", source: "unavailable" } as const,
    };

    expect(validateLlmInvocationTelemetryV1(invocation).tokenUsage).toEqual({
      availability: "unavailable",
      source: "unavailable",
    });
  });
});

describe("P-13A telemetry sinks and summaries", () => {
  it("noop sink accepts records", async () => {
    const sink = new NoopWorkflowTelemetrySink();
    expect(sink.recordLlmInvocation(baseInvocation())).toBeUndefined();
    expect(
      sink.recordRunSummary(
        buildWorkflowRunTelemetrySummaryV1({
          traceId: "trace-1",
          runId: "run-1",
          startedAt: "2026-06-16T00:00:00.000Z",
          endedAt: "2026-06-16T00:00:00.020Z",
          invocations: [],
          result: emptyRunResult(),
          budgetExceeded: false,
          budgetReasons: [],
        }),
      ),
    ).toBeUndefined();
  });

  it("in-memory sink records in order and isolates by run", async () => {
    const sink = new InMemoryWorkflowTelemetrySink();
    await sink.recordLlmInvocation(baseInvocation());
    await sink.recordLlmInvocation({ ...baseInvocation(), invocationId: "inv-2", runId: "run-2" });

    expect(sink.getLlmInvocations().map((e) => e.invocationId)).toEqual(["inv-1", "inv-2"]);
    expect(sink.getLlmInvocations("run-1").map((e) => e.invocationId)).toEqual(["inv-1"]);
  });

  it("builds deterministic run summary from invocations and node runs", () => {
    const invocation2: LlmInvocationTelemetryV1 = {
      ...baseInvocation(),
      invocationId: "inv-2",
      nodeId: "critic1",
      role: "critic",
      model: "critic-model",
      tokenUsage: { availability: "unavailable", source: "unavailable" },
    };
    const invocation3: LlmInvocationTelemetryV1 = {
      ...baseInvocation(),
      invocationId: "inv-3",
      providerId: "a-provider",
      model: "aaa-model",
      role: "memory-curator",
      tokenUsage: { availability: "available", source: "provider", input: 1, output: 2, total: 3 },
    };

    const summary = buildWorkflowRunTelemetrySummaryV1({
      traceId: "trace-1",
      runId: "run-1",
      startedAt: "2026-06-16T00:00:00.000Z",
      endedAt: "2026-06-16T00:00:00.020Z",
      invocations: [baseInvocation(), invocation2, invocation3],
      result: {
        ...emptyRunResult(),
        nodeRuns: [
          {
            nodeId: "writer1",
            status: "success",
            inputs: {},
            outputs: {},
            startedAt: 1,
            endedAt: 2,
          },
          {
            nodeId: "writer2",
            status: "skipped",
            inputs: {},
            outputs: {},
            startedAt: 1,
            endedAt: 2,
          },
          { nodeId: "bad", status: "error", inputs: {}, outputs: {}, startedAt: 1, endedAt: 2 },
        ],
      },
      budgetExceeded: true,
      budgetReasons: ["x"],
    });

    expect(summary.llmCalls).toBe(3);
    expect(summary.byRole).toEqual({ writer: 1, critic: 1, memoryCurator: 1, other: 0 });
    expect(summary.usage).toEqual({
      inputTokens: 12,
      outputTokens: 9,
      totalTokens: 21,
      unavailableInvocationCount: 1,
    });
    expect(summary.modelUsage.map((m) => `${m.providerId}:${m.model}`)).toEqual([
      "a-provider:aaa-model",
      "mock:critic-model",
      "mock:mock-model",
    ]);
    expect(summary.skippedNodeCount).toBe(1);
    expect(summary.failedNodeCount).toBe(1);
    expect(summary.budget).toEqual({ exceeded: true, reasons: ["x"] });
  });
});

function emptyRunResult(): WorkflowRunResult {
  return {
    workflowId: "wf",
    status: "success",
    batches: [],
    nodeRuns: [],
    validationIssues: [],
  };
}
