import { describe, expect, it } from "vitest";
import {
  computeWorkflowHash,
  runWorkflowWithCheckpoint,
  resumeWorkflow,
  WorkflowUsageBudgetController,
  WorkflowUsageBudgetExceededError,
  type LlmInvocationTelemetryV1,
  type WorkflowDefinition,
} from "./index.js";

describe("P-13B workflow usage budget", () => {
  it("accumulates available usage, counts unavailable calls, and deduplicates by invocation id", () => {
    const controller = new WorkflowUsageBudgetController({
      maxLlmCalls: 3,
      maxTotalTokens: 10,
    });

    controller.recordLlmInvocation(invocation("inv-1", 3, 2));
    controller.recordLlmInvocation(invocation("inv-1", 3, 2));
    controller.recordLlmInvocation({
      ...invocation("inv-2", 0, 0),
      tokenUsage: { availability: "unavailable", source: "unavailable" },
    });

    expect(controller.getState()).toMatchObject({
      llmCalls: 2,
      inputTokens: 3,
      outputTokens: 2,
      totalTokens: 5,
      unavailableInvocationCount: 1,
      exceeded: false,
      recordedInvocationIds: ["inv-1", "inv-2"],
    });
  });

  it("throws a typed error once a configured budget is exceeded", () => {
    const controller = new WorkflowUsageBudgetController({ maxTotalTokens: 4 });

    expect(() => controller.recordLlmInvocation(invocation("inv-1", 3, 2))).toThrow(
      WorkflowUsageBudgetExceededError,
    );
    expect(controller.getState().exceededReasons).toEqual(["maxTotalTokens exceeded: 5 > 4"]);
  });

  it("restores old and new checkpoint budget state without double-counting recorded invocations", () => {
    const controller = new WorkflowUsageBudgetController(
      { maxLlmCalls: 5 },
      {
        schema: "awp.workflow-usage-budget-state.v1",
        budget: { maxLlmCalls: 5 },
        llmCalls: 1,
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
        unavailableInvocationCount: 0,
        exceeded: false,
        exceededReasons: [],
        recordedInvocationIds: ["inv-1"],
      },
    );

    controller.recordLlmInvocation(invocation("inv-1", 3, 2));
    controller.recordLlmInvocation(invocation("inv-2", 1, 1));

    expect(controller.getState()).toMatchObject({
      llmCalls: 2,
      totalTokens: 7,
      recordedInvocationIds: ["inv-1", "inv-2"],
    });
  });

  it("exposes budget state through checkpoint callbacks and restores it on resume", async () => {
    const workflow: WorkflowDefinition = {
      id: "budget-checkpoint",
      name: "Budget Checkpoint",
      version: 1,
      nodes: [{ id: "n1", type: "userInput", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    const budget = { maxLlmCalls: 3 };
    const firstController = new WorkflowUsageBudgetController(budget);
    let capturedState: ReturnType<WorkflowUsageBudgetController["getState"]> | undefined;

    await runWorkflowWithCheckpoint(
      workflow,
      {
        userInput: async ({ context }) => {
          context?.usageBudgetController?.recordLlmInvocation(invocation("inv-1", 1, 1));
          return { outputs: { text: "ok" } };
        },
      },
      undefined,
      { usageBudgetController: firstController },
      {
        onUsageBudgetStateChanged: async (_runId, state) => {
          capturedState = state;
        },
      },
      "run-budget",
    );

    expect(capturedState?.recordedInvocationIds).toEqual(["inv-1"]);

    const secondController = new WorkflowUsageBudgetController(budget);
    await resumeWorkflow(
      workflow,
      {
        userInput: async ({ context }) => {
          context?.usageBudgetController?.recordLlmInvocation(invocation("inv-1", 1, 1));
          context?.usageBudgetController?.recordLlmInvocation(invocation("inv-2", 1, 1));
          return { outputs: { text: "resumed" } };
        },
      },
      {
        runId: "run-budget",
        workflowId: workflow.id,
        workflowHash: computeWorkflowHash(workflow),
        completedNodeIds: [],
        skippedNodeIds: [],
        nodeOutputs: {},
        usageBudgetState: capturedState,
      },
      undefined,
      { usageBudgetController: secondController },
    );

    expect(secondController.getState()).toMatchObject({
      llmCalls: 2,
      totalTokens: 4,
      recordedInvocationIds: ["inv-1", "inv-2"],
    });
  });
});

function invocation(id: string, input: number, output: number): LlmInvocationTelemetryV1 {
  return {
    invocationId: id,
    traceId: "trace-test",
    runId: "run-test",
    workflowId: "wf",
    workflowVersion: 1,
    nodeId: "agent",
    nodeType: "specializedAgent",
    role: "writer",
    attempt: 1,
    providerId: "mock",
    model: "mock-model",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:00:01.000Z",
    latencyMs: 1000,
    status: "success",
    tokenUsage: {
      availability: "available",
      source: "provider",
      input,
      output,
      total: input + output,
    },
  };
}
