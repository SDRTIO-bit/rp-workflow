/**
 * Agent Session Store — interface and in-memory implementation.
 *
 * The store owns all agent session data. It is injected at server startup
 * and shared across all agent nodes. Isolation is enforced by session key.
 *
 * P-11.1: Added idempotent commit semantics via turnId + contentHash.
 */

import type {
  AgentSessionKeyV1,
  AgentSessionContextV1,
  AgentSessionDeltaV1,
} from "./agentSession.js";

// ============ Idempotent Commit Types ============

/**
 * Dedup key for idempotent session commits.
 * Combines session isolation key with the specific turn being committed.
 */
export interface AgentSessionCommitDedupKeyV1 {
  /** The conversation session identifier */
  sessionId: string;
  /** The agent node that owns this session */
  agentNodeId: string;
  /** The turn identifier within this session */
  turnId: string;
}

/**
 * Result of an idempotent session commit.
 */
export type AgentSessionCommitResultV1 =
  | { committed: true; deduplicated: false }
  | { committed: false; deduplicated: true }
  | { committed: false; deduplicated: false; conflict: true; error: string };

// ============ Store Interface ============

export interface AgentSessionStore {
  load(key: AgentSessionKeyV1): Promise<AgentSessionContextV1 | null>;
  append(key: AgentSessionKeyV1, delta: AgentSessionDeltaV1): Promise<void>;
  clear(key: AgentSessionKeyV1): Promise<void>;

  /**
   * Idempotent session commit.
   *
   * - First commit with a given (sessionId, agentNodeId, turnId): normal insert.
   * - Same dedup key + same contentHash: returns deduplicated (no-op).
   * - Same dedup key + different contentHash: throws a conflict error.
   *
   * The contentHash should be a stable hash of the final draft text.
   */
  commitIdempotent(
    key: AgentSessionKeyV1,
    delta: AgentSessionDeltaV1,
    dedupKey: AgentSessionCommitDedupKeyV1,
    contentHash: string,
  ): Promise<AgentSessionCommitResultV1>;
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

function serializeDedupKey(dk: AgentSessionCommitDedupKeyV1): string {
  return `agent-session-commit:${encodeURIComponent(dk.sessionId)}:${encodeURIComponent(dk.agentNodeId)}:${encodeURIComponent(dk.turnId)}`;
}

// ============ In-Memory Implementation ============

export class InMemoryAgentSessionStore implements AgentSessionStore {
  private sessions = new Map<string, AgentSessionContextV1>();
  /** Dedup records: serialized dedup key → content hash */
  private commitDedup = new Map<string, string>();

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

  async commitIdempotent(
    key: AgentSessionKeyV1,
    delta: AgentSessionDeltaV1,
    dedupKey: AgentSessionCommitDedupKeyV1,
    contentHash: string,
  ): Promise<AgentSessionCommitResultV1> {
    const dk = serializeDedupKey(dedupKey);
    const existingHash = this.commitDedup.get(dk);

    if (existingHash !== undefined) {
      if (existingHash === contentHash) {
        return { committed: false, deduplicated: true };
      }
      return {
        committed: false,
        deduplicated: false,
        conflict: true,
        error: `session commit conflict: turnId="${dedupKey.turnId}" already committed with different content`,
      };
    }

    // First commit: record dedup + append
    this.commitDedup.set(dk, contentHash);
    await this.append(key, delta);
    return { committed: true, deduplicated: false };
  }

  async clear(key: AgentSessionKeyV1): Promise<void> {
    this.sessions.delete(serializeKey(key));
  }
}
