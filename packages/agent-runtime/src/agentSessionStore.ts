/**
 * Agent Session Store — interface and in-memory implementation.
 *
 * The store owns all agent session data. It is injected at server startup
 * and shared across all agent nodes. Isolation is enforced by session key.
 */

import type {
  AgentSessionKeyV1,
  AgentSessionContextV1,
  AgentSessionDeltaV1,
} from "./agentSession.js";

// ============ Store Interface ============

export interface AgentSessionStore {
  load(key: AgentSessionKeyV1): Promise<AgentSessionContextV1 | null>;
  append(key: AgentSessionKeyV1, delta: AgentSessionDeltaV1): Promise<void>;
  clear(key: AgentSessionKeyV1): Promise<void>;
}

// ============ Key Serialization ============

function serializeKey(key: AgentSessionKeyV1): string {
  const parts = [
    key.tenantId,
    key.workflowInstanceId,
    key.conversationId,
    key.agentNodeId,
    key.branchId ?? "",
  ];
  return parts.map((p) => encodeURIComponent(p)).join("::");
}

// ============ In-Memory Implementation ============

export class InMemoryAgentSessionStore implements AgentSessionStore {
  private sessions = new Map<string, AgentSessionContextV1>();

  async load(key: AgentSessionKeyV1): Promise<AgentSessionContextV1 | null> {
    return this.sessions.get(serializeKey(key)) ?? null;
  }

  async append(key: AgentSessionKeyV1, delta: AgentSessionDeltaV1): Promise<void> {
    const k = serializeKey(key);
    const existing = this.sessions.get(k);
    if (existing) {
      existing.turns.push(delta.newTurn);
      existing.estimatedTokens += delta.newTurn.tokenUsage.input + delta.newTurn.tokenUsage.output;
    } else {
      this.sessions.set(k, {
        sessionKey: key,
        turns: [delta.newTurn],
        estimatedTokens: delta.newTurn.tokenUsage.input + delta.newTurn.tokenUsage.output,
        truncated: false,
      });
    }
  }

  async clear(key: AgentSessionKeyV1): Promise<void> {
    this.sessions.delete(serializeKey(key));
  }
}
