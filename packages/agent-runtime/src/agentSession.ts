/**
 * Agent Session Memory Types — V1
 *
 * Agent Session represents ONE agent node's continuous conversation context.
 * It is NOT: recentMessages, RP Memory, Timeline, Workflow checkpoint,
 * vector memory, or Provider Prompt Cache.
 *
 * Isolation: tenantId + workflowInstanceId + conversationId + agentNodeId (+ branchId)
 */

import type { NodeModelConfig } from "./modelConfig.js";

// ============ Session Key ============

/** Stable isolation key for agent sessions. */
export interface AgentSessionKeyV1 {
  tenantId: string;
  workflowInstanceId: string;
  conversationId: string;
  agentNodeId: string;
  branchId?: string;
}

// ============ Session Config ============

/** Per-agent session configuration. Default mode is "stateless". */
export interface AgentSessionConfig {
  mode: "stateless" | "stateful";
  maxTurns?: number;
  maxTokens?: number;
  includeToolCalls?: boolean;
  autoSummarize?: boolean;
}

export const DEFAULT_SESSION_CONFIG: AgentSessionConfig = {
  mode: "stateless",
  maxTurns: 20,
  maxTokens: 16000,
  includeToolCalls: true,
  autoSummarize: false,
};

// ============ Tool Call (reserved) ============

/** Reserved for future tool loop implementation. */
export interface AgentToolCallV1 {
  toolId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  error?: string;
  startedAt: string;
  endedAt?: string;
}

// ============ Session Turn ============

export interface AgentTurnV1 {
  turnIndex: number;
  input: unknown;
  assistantOutput: unknown;
  toolCalls?: AgentToolCallV1[];
  modelConfig: NodeModelConfig;
  tokenUsage: { input: number; output: number };
  createdAt: string;
}

// ============ Session Context ============

export interface AgentSessionContextV1 {
  sessionKey: AgentSessionKeyV1;
  turns: AgentTurnV1[];
  summary?: string;
  estimatedTokens: number;
  truncated: boolean;
}

// ============ Session Delta ============

export interface AgentSessionDeltaV1 {
  sessionKey: AgentSessionKeyV1;
  newTurn: AgentTurnV1;
}

// ============ Session Summary ============

/** Summary emitted when a session exceeds maxTurns or maxTokens. */
export interface AgentSessionSummaryV1 {
  sessionKey: AgentSessionKeyV1;
  totalTurns: number;
  totalTokens: number;
  summary: string;
  truncated: boolean;
  truncatedTurnCount: number;
}
