/**
 * Agent V2 Node — Session-Aware Agent
 *
 * Accepts optional sessionContext (loaded by agentSessionLoadV1) and
 * integrates session history into the LLM prompt. Outputs sessionDelta
 * so agentSessionCommitV1 can persist the new turn.
 *
 * Prompt construction order:
 *   1. System Prompt
 *   2. Skills
 *   3. Session Summary (if present)
 *   4. Session History Turns (newest last, oldest first trimmed under budget)
 *   5. Current Explicit Upstream Context
 *   6. Current Instruction
 *
 * Budget: current input and system prompt are protected. Oldest history
 * turns are dropped first. Token estimation uses character ratio (chars/4).
 */

import type { NodeDefinition, NodeExecutor, NodeExecutionInput } from "@awp/workflow-core";
import type { LlmAdapter, LlmCompletionResult } from "./types.js";
import type {
  AgentSessionContextV1,
  AgentSessionDeltaV1,
  AgentTurnV1,
  AgentSessionConfig,
} from "./agentSession.js";
import { DEFAULT_SESSION_CONFIG } from "./agentSession.js";
import type { NodeModelConfig } from "./modelConfig.js";
import { coerceLlmTokenUsage, getKnownTokenUsage } from "./llmUsage.js";

// ============ Budget ============

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateHistory(
  turns: AgentTurnV1[],
  maxTokens: number,
  protectedTokens: number,
): { included: AgentTurnV1[]; dropped: number } {
  if (turns.length === 0) return { included: [], dropped: 0 };

  const available = maxTokens - protectedTokens;
  if (available <= 0) return { included: [], dropped: turns.length };

  const included: AgentTurnV1[] = [];
  let used = 0;
  let dropped = 0;

  // Keep newest first (iterate from end), drop oldest when over budget
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const turnText = formatTurn(turn);
    const turnTokens = estimateTokens(turnText);
    if (used + turnTokens > available) {
      dropped++;
      continue;
    }
    used += turnTokens;
    included.unshift(turn); // restore chronological order
  }

  return { included, dropped };
}

function formatTurn(turn: AgentTurnV1): string {
  const inputStr = typeof turn.input === "string" ? turn.input : JSON.stringify(turn.input);
  const outputStr =
    typeof turn.assistantOutput === "string"
      ? turn.assistantOutput
      : JSON.stringify(turn.assistantOutput);
  return `[Turn ${turn.turnIndex}]\nUser: ${inputStr}\nAssistant: ${outputStr}`;
}

// ============ Prompt Assembly ============

interface PromptAssemblyInput {
  systemPrompt: string;
  skills: string[];
  sessionContext?: AgentSessionContextV1;
  currentContext?: string;
  currentInstruction?: string;
  sessionBudgetTokens: number;
}

function assemblePrompt(input: PromptAssemblyInput): {
  fullPrompt: string;
  includedTurns: number;
  droppedTurns: number;
  estimatedTokens: number;
  truncated: boolean;
} {
  const parts: string[] = [];
  const { sessionContext, sessionBudgetTokens } = input;

  // 1. System Prompt (protected)
  if (input.systemPrompt) {
    parts.push(input.systemPrompt);
  }

  // 2. Skills
  if (input.skills.length > 0) {
    parts.push("## Skills\n" + input.skills.join("\n"));
  }

  // 3. Session Summary
  if (sessionContext?.summary) {
    parts.push("## Conversation Summary\n" + sessionContext.summary);
  }

  // Compute protected tokens: system + skills + summary + current input + instruction
  const preHistory = parts.join("\n");
  const preTokens = estimateTokens(preHistory);
  const currentInput = [input.currentContext, input.currentInstruction]
    .filter(Boolean)
    .join("\n\n");
  const protectedTokens = preTokens + estimateTokens(currentInput) + 50; // 50 token buffer

  // 4. Session History (budgeted)
  let includedTurns = 0;
  let droppedTurns = 0;
  if (sessionContext && sessionContext.turns.length > 0) {
    const { included, dropped } = truncateHistory(
      sessionContext.turns,
      sessionBudgetTokens,
      protectedTokens,
    );
    if (included.length > 0) {
      parts.push("## Conversation History\n" + included.map(formatTurn).join("\n\n"));
    }
    includedTurns = included.length;
    droppedTurns = dropped;
  }

  // 5. Current Context
  if (input.currentContext) {
    parts.push("## Current Context\n" + input.currentContext);
  }

  // 6. Current Instruction
  if (input.currentInstruction) {
    parts.push("## Instruction\n" + input.currentInstruction);
  }

  const fullPrompt = parts.join("\n\n");
  return {
    fullPrompt,
    includedTurns,
    droppedTurns,
    estimatedTokens: estimateTokens(fullPrompt),
    truncated: droppedTurns > 0 || (sessionContext?.truncated ?? false),
  };
}

// ============ Node Definition ============

export const agentV2Definition: NodeDefinition = {
  type: "agentV2",
  label: "Agent V2 (Session-Aware)",
  category: "core",
  description:
    "Session-aware LLM agent. Integrates session history into prompt, outputs session delta for commit.",
  color: "#2563eb",
  ports: [
    {
      id: "context",
      label: "Context",
      dataType: "context",
      direction: "input",
      required: false,
    },
    {
      id: "instruction",
      label: "Instruction",
      dataType: "text",
      direction: "input",
      required: false,
    },
    {
      id: "sessionContext",
      label: "Session Context",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "agent.session-context.v1",
    },
    {
      id: "result",
      label: "Result",
      dataType: "draft",
      direction: "output",
    },
    {
      id: "sessionDelta",
      label: "Session Delta",
      dataType: "json",
      direction: "output",
      schemaId: "agent.session-delta.v1",
    },
  ],
};

// ============ Services ============

export interface AgentV2Services {
  adapter: LlmAdapter;
  modelConfig?: NodeModelConfig;
}

// ============ Executor ============

export function createAgentV2Executor(services: AgentV2Services): NodeExecutor {
  return async (input: NodeExecutionInput) => {
    const {
      context: currentContext,
      instruction: currentInstruction,
      sessionContext,
    } = input.inputs;
    const node = input.node;
    const config = node.config as Record<string, unknown>;

    // Session config from node
    const sessionConfig: AgentSessionConfig = {
      mode:
        ((config.sessionConfig as Record<string, unknown>)?.mode as AgentSessionConfig["mode"]) ??
        DEFAULT_SESSION_CONFIG.mode,
      maxTurns:
        ((config.sessionConfig as Record<string, unknown>)?.maxTurns as number) ??
        DEFAULT_SESSION_CONFIG.maxTurns,
      maxTokens:
        ((config.sessionConfig as Record<string, unknown>)?.maxTokens as number) ??
        DEFAULT_SESSION_CONFIG.maxTokens,
      includeToolCalls:
        ((config.sessionConfig as Record<string, unknown>)?.includeToolCalls as boolean) ??
        DEFAULT_SESSION_CONFIG.includeToolCalls,
      autoSummarize:
        ((config.sessionConfig as Record<string, unknown>)?.autoSummarize as boolean) ??
        DEFAULT_SESSION_CONFIG.autoSummarize,
    };

    const isStateful = sessionConfig.mode === "stateful";
    const sessionBudgetTokens = sessionConfig.maxTokens ?? DEFAULT_SESSION_CONFIG.maxTokens!;

    // Only use session context in stateful mode
    const effectiveSessionContext = isStateful
      ? (sessionContext as AgentSessionContextV1 | undefined)
      : undefined;

    // Build prompt
    const promptAssembly = assemblePrompt({
      systemPrompt: String(config.systemPrompt ?? ""),
      skills: Array.isArray(config.skills) ? config.skills.map(String) : [],
      sessionContext: effectiveSessionContext,
      currentContext: typeof currentContext === "string" ? currentContext : undefined,
      currentInstruction: typeof currentInstruction === "string" ? currentInstruction : undefined,
      sessionBudgetTokens,
    });

    // Call LLM
    const model = String(config.model ?? services.modelConfig?.model ?? "default");
    const startedAt = Date.now();
    let llmResult: LlmCompletionResult;
    try {
      llmResult = await services.adapter.complete({
        model,
        prompt: promptAssembly.fullPrompt,
        temperature: (config.temperature as number) ?? services.modelConfig?.temperature,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`agentV2: LLM call failed: ${message}`);
    }
    const latencyMs = Date.now() - startedAt;

    // Build session delta (only if stateful)
    const turnIndex = (effectiveSessionContext?.turns.length ?? 0) + 1;
    const knownUsage = getKnownTokenUsage(coerceLlmTokenUsage(llmResult.tokenUsage)) ?? {
      input: 0,
      output: 0,
    };
    const sessionDelta: AgentSessionDeltaV1 | undefined =
      isStateful && effectiveSessionContext
        ? {
            sessionKey: effectiveSessionContext.sessionKey,
            newTurn: {
              turnIndex,
              input: {
                context: currentContext,
                instruction: currentInstruction,
              },
              assistantOutput: llmResult.text,
              modelConfig: { model },
              tokenUsage: knownUsage,
              createdAt: new Date().toISOString(),
            },
          }
        : undefined;

    // Trace metadata
    const metadata: Record<string, unknown> = {
      sessionMode: sessionConfig.mode,
      includedTurns: promptAssembly.includedTurns,
      droppedTurns: promptAssembly.droppedTurns,
      estimatedSessionTokens: promptAssembly.estimatedTokens,
      sessionTruncated: promptAssembly.truncated,
      latencyMs,
      model,
      turnIndex,
    };

    return {
      outputs: {
        result: llmResult.text,
        sessionDelta,
        ...(sessionDelta ? { _sessionDelta: sessionDelta } : {}),
      },
      metadata,
    };
  };
}
