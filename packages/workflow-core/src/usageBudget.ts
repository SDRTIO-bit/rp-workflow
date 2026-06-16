import type { LlmInvocationTelemetryV1 } from "./telemetry.js";

export type WorkflowUsageBudgetV1 = {
  maxLlmCalls?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  allowUnavailableUsage?: boolean;
};

export type WorkflowUsageBudgetStateV1 = {
  schema: "awp.workflow-usage-budget-state.v1";
  budget: WorkflowUsageBudgetV1;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  unavailableInvocationCount: number;
  exceeded: boolean;
  exceededReasons: string[];
  recordedInvocationIds: string[];
};

export class WorkflowUsageBudgetExceededError extends Error {
  readonly code = "WORKFLOW_USAGE_BUDGET_EXCEEDED";
  readonly reasons: string[];
  readonly state: WorkflowUsageBudgetStateV1;

  constructor(reasons: string[], state: WorkflowUsageBudgetStateV1) {
    super(`Workflow usage budget exceeded: ${reasons.join("; ")}`);
    this.name = "WorkflowUsageBudgetExceededError";
    this.reasons = [...reasons];
    this.state = cloneState(state);
  }
}

export class WorkflowUsageBudgetController {
  private state: WorkflowUsageBudgetStateV1;

  constructor(budget: WorkflowUsageBudgetV1, initialState?: WorkflowUsageBudgetStateV1) {
    this.state = initialState
      ? normalizeState(initialState, budget)
      : {
          schema: "awp.workflow-usage-budget-state.v1",
          budget: normalizeBudget(budget),
          llmCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          unavailableInvocationCount: 0,
          exceeded: false,
          exceededReasons: [],
          recordedInvocationIds: [],
        };
  }

  recordLlmInvocation(event: LlmInvocationTelemetryV1): WorkflowUsageBudgetStateV1 {
    if (this.state.recordedInvocationIds.includes(event.invocationId)) {
      return this.getState();
    }

    this.state.recordedInvocationIds.push(event.invocationId);
    this.state.llmCalls++;

    if (event.tokenUsage.availability === "available") {
      this.state.inputTokens += event.tokenUsage.input;
      this.state.outputTokens += event.tokenUsage.output;
      this.state.totalTokens += event.tokenUsage.total;
    } else {
      this.state.unavailableInvocationCount++;
    }

    const reasons = evaluateBudget(this.state);
    if (reasons.length > 0) {
      this.state.exceeded = true;
      this.state.exceededReasons = mergeReasons(this.state.exceededReasons, reasons);
      throw new WorkflowUsageBudgetExceededError(this.state.exceededReasons, this.state);
    }

    return this.getState();
  }

  restore(state: WorkflowUsageBudgetStateV1): void {
    this.state = normalizeState(state, this.state.budget);
  }

  getState(): WorkflowUsageBudgetStateV1 {
    return cloneState(this.state);
  }
}

function evaluateBudget(state: WorkflowUsageBudgetStateV1): string[] {
  const budget = state.budget;
  const reasons: string[] = [];
  if (budget.maxLlmCalls !== undefined && state.llmCalls > budget.maxLlmCalls) {
    reasons.push(`maxLlmCalls exceeded: ${state.llmCalls} > ${budget.maxLlmCalls}`);
  }
  if (budget.maxInputTokens !== undefined && state.inputTokens > budget.maxInputTokens) {
    reasons.push(`maxInputTokens exceeded: ${state.inputTokens} > ${budget.maxInputTokens}`);
  }
  if (budget.maxOutputTokens !== undefined && state.outputTokens > budget.maxOutputTokens) {
    reasons.push(`maxOutputTokens exceeded: ${state.outputTokens} > ${budget.maxOutputTokens}`);
  }
  if (budget.maxTotalTokens !== undefined && state.totalTokens > budget.maxTotalTokens) {
    reasons.push(`maxTotalTokens exceeded: ${state.totalTokens} > ${budget.maxTotalTokens}`);
  }
  if (budget.allowUnavailableUsage === false && state.unavailableInvocationCount > 0) {
    reasons.push("unavailable token usage is not allowed");
  }
  return reasons;
}

function normalizeState(
  state: WorkflowUsageBudgetStateV1,
  budget: WorkflowUsageBudgetV1,
): WorkflowUsageBudgetStateV1 {
  return {
    schema: "awp.workflow-usage-budget-state.v1",
    budget: normalizeBudget(state.budget ?? budget),
    llmCalls: state.llmCalls ?? 0,
    inputTokens: state.inputTokens ?? 0,
    outputTokens: state.outputTokens ?? 0,
    totalTokens: state.totalTokens ?? 0,
    unavailableInvocationCount: state.unavailableInvocationCount ?? 0,
    exceeded: Boolean(state.exceeded),
    exceededReasons: [...(state.exceededReasons ?? [])],
    recordedInvocationIds: [...(state.recordedInvocationIds ?? [])],
  };
}

function normalizeBudget(budget: WorkflowUsageBudgetV1): WorkflowUsageBudgetV1 {
  return {
    ...(budget.maxLlmCalls !== undefined ? { maxLlmCalls: budget.maxLlmCalls } : {}),
    ...(budget.maxInputTokens !== undefined ? { maxInputTokens: budget.maxInputTokens } : {}),
    ...(budget.maxOutputTokens !== undefined ? { maxOutputTokens: budget.maxOutputTokens } : {}),
    ...(budget.maxTotalTokens !== undefined ? { maxTotalTokens: budget.maxTotalTokens } : {}),
    ...(budget.allowUnavailableUsage !== undefined
      ? { allowUnavailableUsage: budget.allowUnavailableUsage }
      : {}),
  };
}

function cloneState(state: WorkflowUsageBudgetStateV1): WorkflowUsageBudgetStateV1 {
  return {
    ...state,
    budget: { ...state.budget },
    exceededReasons: [...state.exceededReasons],
    recordedInvocationIds: [...state.recordedInvocationIds],
  };
}

function mergeReasons(existing: string[], next: string[]): string[] {
  return [...new Set([...existing, ...next])];
}
