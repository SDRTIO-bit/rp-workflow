/**
 * Agent Session Nodes — V1
 *
 * Provides agentSessionLoadV1, agentSessionCommitV1, and agentSessionClearV1.
 * These are generic platform nodes, NOT RP-specific.
 *
 * Stateless mode: load returns empty context, commit is no-op.
 * Stateful mode: load returns session history, commit saves new turns.
 *
 * P-11.1: Commit now uses idempotent session commit with turnId + contentHash dedup.
 */

import type { NodeDefinition, NodeExecutor } from "@awp/workflow-core";
import type {
  AgentSessionKeyV1,
  AgentSessionContextV1,
  AgentSessionDeltaV1,
  AgentSessionConfig,
  AgentTurnV1,
} from "./agentSession.js";
import { DEFAULT_SESSION_CONFIG } from "./agentSession.js";
import type {
  AgentSessionStore,
  AgentSessionCommitDedupKeyV1,
  AgentSessionCommitResultV1,
} from "./agentSessionStore.js";

// ============ Content Hash (djb2, deterministic, no crypto) ============

function computeContentHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff;
  }
  return `sha_${(hash >>> 0).toString(36)}`;
}

// ============ Node Definitions ============

export const agentSessionLoadV1Definition: NodeDefinition = {
  type: "agentSessionLoadV1",
  label: "Agent Session Load",
  category: "core",
  description:
    "Loads the agent session context for stateful agents. Returns empty context for stateless.",
  color: "#0ea5e9",
  ports: [
    {
      id: "sessionKey",
      label: "Session Key",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "agent.session-key.v1",
    },
    {
      id: "sessionConfig",
      label: "Session Config",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "agent.session-config.v1",
    },
    {
      id: "sessionContext",
      label: "Session Context",
      dataType: "json",
      direction: "output",
      schemaId: "agent.session-context.v1",
    },
  ],
};

export const agentSessionCommitV1Definition: NodeDefinition = {
  type: "agentSessionCommitV1",
  label: "Agent Session Commit",
  category: "core",
  description: "Commits a new turn to the agent session store. No-op for stateless agents.",
  color: "#10b981",
  ports: [
    {
      id: "sessionDelta",
      label: "Session Delta",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "agent.session-delta.v1",
    },
    {
      id: "sessionConfig",
      label: "Session Config",
      dataType: "json",
      direction: "input",
      required: false,
      schemaId: "agent.session-config.v1",
    },
    {
      id: "turnId",
      label: "Turn ID",
      wireType: "json",
      direction: "input",
      required: false,
    },
    {
      id: "commitResult",
      label: "Commit Result",
      dataType: "json",
      direction: "output",
      schemaId: "agent.session-commit-result.v1",
    },
  ],
};

export const agentSessionClearV1Definition: NodeDefinition = {
  type: "agentSessionClearV1",
  label: "Agent Session Clear",
  category: "core",
  description: "Clears one agent's session. Does not affect other agents or conversations.",
  color: "#ef4444",
  ports: [
    {
      id: "sessionKey",
      label: "Session Key",
      dataType: "json",
      direction: "input",
      required: true,
      schemaId: "agent.session-key.v1",
    },
    {
      id: "clearResult",
      label: "Clear Result",
      dataType: "json",
      direction: "output",
      schemaId: "agent.session-clear-result.v1",
    },
  ],
};

// ============ Session Helpers ============

export interface AgentSessionServices {
  store: AgentSessionStore;
}

function getSessionConfig(nodeConfig?: Record<string, unknown>): AgentSessionConfig {
  const raw = (nodeConfig?.sessionConfig ?? {}) as Partial<AgentSessionConfig>;
  return {
    mode: raw.mode ?? DEFAULT_SESSION_CONFIG.mode,
    maxTurns: raw.maxTurns ?? DEFAULT_SESSION_CONFIG.maxTurns,
    maxTokens: raw.maxTokens ?? DEFAULT_SESSION_CONFIG.maxTokens,
    includeToolCalls: raw.includeToolCalls ?? DEFAULT_SESSION_CONFIG.includeToolCalls,
    autoSummarize: raw.autoSummarize ?? DEFAULT_SESSION_CONFIG.autoSummarize,
  };
}

function isStateful(config: AgentSessionConfig): boolean {
  return config.mode === "stateful";
}

function truncateTurns(
  turns: AgentTurnV1[],
  maxTurns: number,
  maxTokens: number,
): { turns: AgentTurnV1[]; truncated: boolean; truncatedCount: number } {
  if (turns.length === 0) return { turns: [], truncated: false, truncatedCount: 0 };

  let tokenSum = 0;
  const kept: AgentTurnV1[] = [];
  let truncated = false;

  // Keep most recent turns first (within limits), iterate newest to oldest
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    const turnTokens = turn.tokenUsage.input + turn.tokenUsage.output;

    if (kept.length >= maxTurns || tokenSum + turnTokens > maxTokens) {
      truncated = true;
      continue;
    }

    tokenSum += turnTokens;
    kept.unshift(turn); // restore chronological order
  }

  return {
    turns: kept,
    truncated,
    truncatedCount: turns.length - kept.length,
  };
}

// ============ Executor: Load ============

export function createAgentSessionLoadV1Executor(services: AgentSessionServices): NodeExecutor {
  return async (input) => {
    const sessionKey = input.inputs.sessionKey as AgentSessionKeyV1 | undefined;
    if (!sessionKey?.agentNodeId) {
      throw new Error("agentSessionLoadV1: sessionKey with agentNodeId is required");
    }

    const nodeConfig = input.node.config as Record<string, unknown> | undefined;
    const sessionConfig = getSessionConfig(nodeConfig);

    if (!isStateful(sessionConfig)) {
      // Stateless: return empty context
      return {
        outputs: {
          sessionContext: {
            sessionKey,
            turns: [],
            estimatedTokens: 0,
            truncated: false,
          } satisfies AgentSessionContextV1,
          metadata: { mode: "stateless" },
        },
      };
    }

    // Stateful: load from store
    const stored = await services.store.load(sessionKey);
    const context: AgentSessionContextV1 = stored ?? {
      sessionKey,
      turns: [],
      estimatedTokens: 0,
      truncated: false,
    };

    // Apply truncation
    const maxTurns = sessionConfig.maxTurns ?? DEFAULT_SESSION_CONFIG.maxTurns!;
    const maxTokens = sessionConfig.maxTokens ?? DEFAULT_SESSION_CONFIG.maxTokens!;
    const truncResult = truncateTurns(context.turns, maxTurns, maxTokens);

    return {
      outputs: {
        sessionContext: {
          sessionKey,
          turns: truncResult.turns,
          summary: context.summary,
          estimatedTokens: truncResult.turns.reduce(
            (s, t) => s + t.tokenUsage.input + t.tokenUsage.output,
            0,
          ),
          truncated: truncResult.truncated,
        } satisfies AgentSessionContextV1,
        metadata: {
          mode: "stateful",
          loadedTurns: stored ? stored.turns.length : 0,
          afterTruncation: truncResult.turns.length,
          truncated: truncResult.truncated,
          truncatedCount: truncResult.truncatedCount,
        },
      },
    };
  };
}

// ============ Executor: Commit ============

export function createAgentSessionCommitV1Executor(services: AgentSessionServices): NodeExecutor {
  return async (input) => {
    const sessionDelta = input.inputs.sessionDelta as AgentSessionDeltaV1 | undefined;
    if (!sessionDelta?.sessionKey?.agentNodeId) {
      throw new Error("agentSessionCommitV1: sessionDelta with sessionKey is required");
    }

    const nodeConfig = input.node.config as Record<string, unknown> | undefined;
    const sessionConfig = getSessionConfig(nodeConfig);

    if (!isStateful(sessionConfig)) {
      return {
        outputs: {
          commitResult: { committed: false, reason: "stateless" },
          metadata: { mode: "stateless" },
        },
      };
    }

    // P-11.1: Idempotent commit when turnId is provided
    const turnId =
      typeof input.inputs.turnId === "string" && input.inputs.turnId
        ? input.inputs.turnId
        : undefined;

    if (turnId) {
      const dedupKey: AgentSessionCommitDedupKeyV1 = {
        sessionId: sessionDelta.sessionKey.conversationId,
        agentNodeId: sessionDelta.sessionKey.agentNodeId,
        turnId,
      };
      const draftText = String(sessionDelta.newTurn.assistantOutput ?? "");
      const contentHash = computeContentHash(draftText);

      try {
        const result: AgentSessionCommitResultV1 = await services.store.commitIdempotent(
          sessionDelta.sessionKey,
          sessionDelta,
          dedupKey,
          contentHash,
        );

        if (result.committed) {
          return {
            outputs: {
              commitResult: { committed: true, turnIndex: sessionDelta.newTurn.turnIndex, turnId },
              metadata: { mode: "stateful", storeSuccess: true, dedupKey },
            },
          };
        }

        if (result.deduplicated) {
          return {
            outputs: {
              commitResult: { committed: false, deduplicated: true, turnId },
              metadata: { mode: "stateful", deduplicated: true, turnId },
            },
          };
        }

        // Must be conflict
        return {
          outputs: {
            commitResult: { committed: false, conflict: true, error: result.error, turnId },
            metadata: { mode: "stateful", conflict: true, error: result.error, turnId },
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          outputs: {
            commitResult: { committed: false, error: message, turnId },
            metadata: { mode: "stateful", storeSuccess: false, error: message },
          },
        };
      }
    }

    // Legacy path: no turnId → fall back to plain append
    try {
      await services.store.append(sessionDelta.sessionKey, sessionDelta);
      return {
        outputs: {
          commitResult: { committed: true, turnIndex: sessionDelta.newTurn.turnIndex },
          metadata: { mode: "stateful", storeSuccess: true },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        outputs: {
          commitResult: { committed: false, error: message },
          metadata: { mode: "stateful", storeSuccess: false, error: message },
        },
      };
    }
  };
}

// ============ Executor: Clear ============

export function createAgentSessionClearV1Executor(services: AgentSessionServices): NodeExecutor {
  return async (input) => {
    const sessionKey = input.inputs.sessionKey as AgentSessionKeyV1 | undefined;
    if (!sessionKey?.agentNodeId) {
      throw new Error("agentSessionClearV1: sessionKey with agentNodeId is required");
    }

    try {
      await services.store.clear(sessionKey);
      return {
        outputs: {
          clearResult: { cleared: true },
          metadata: { storeSuccess: true },
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        outputs: {
          clearResult: { cleared: false, error: message },
          metadata: { storeSuccess: false, error: message },
        },
      };
    }
  };
}
