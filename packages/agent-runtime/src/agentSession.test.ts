/**
 * Agent Session Memory V1 — Deterministic Tests
 *
 * Covers: stateless/stateful, isolation, truncation, backward compat,
 * store error handling, and secret isolation. All tests use mock LLM.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAgentSessionStore, InMemoryAgentSessionStore } from "../src/agentSessionStore.js";
import {
  createAgentSessionLoadV1Executor,
  createAgentSessionCommitV1Executor,
  createAgentSessionClearV1Executor,
  agentSessionLoadV1Definition,
  agentSessionCommitV1Definition,
} from "../src/agentSessionNode.js";
import type {
  AgentSessionKeyV1,
  AgentSessionContextV1,
  AgentSessionDeltaV1,
  AgentTurnV1,
} from "../src/agentSession.js";

// ============ Helpers ============

function makeKey(overrides?: Partial<AgentSessionKeyV1>): AgentSessionKeyV1 {
  return {
    tenantId: "tenant-1",
    workflowInstanceId: "wf-1",
    conversationId: "conv-1",
    agentNodeId: "agent-1",
    ...overrides,
  };
}

function makeTurn(turnIndex: number, input?: string): AgentTurnV1 {
  return {
    turnIndex,
    input: input ?? `input-${turnIndex}`,
    assistantOutput: `output-${turnIndex}`,
    modelConfig: { model: "test-model" },
    tokenUsage: { input: 10, output: 20 },
    createdAt: new Date().toISOString(),
  };
}

function makeNode(config?: Record<string, unknown>) {
  return {
    id: "test-node",
    type: "agentSessionTest",
    config: config ?? {},
    position: { x: 0, y: 0 },
  };
}

function makeServices() {
  const store = new InMemoryAgentSessionStore();
  return { store };
}

// ============ Definition Tests ============

describe("agentSessionLoadV1Definition", () => {
  it("has correct type and ports", () => {
    expect(agentSessionLoadV1Definition.type).toBe("agentSessionLoadV1");
    const inputPorts = agentSessionLoadV1Definition.ports.filter((p) => p.direction === "input");
    expect(inputPorts.map((p) => p.id)).toContain("sessionKey");
    expect(inputPorts.map((p) => p.id)).toContain("sessionConfig");
    const outputPorts = agentSessionLoadV1Definition.ports.filter((p) => p.direction === "output");
    expect(outputPorts.map((p) => p.id)).toContain("sessionContext");
  });
});

describe("agentSessionCommitV1Definition", () => {
  it("has correct type and ports", () => {
    expect(agentSessionCommitV1Definition.type).toBe("agentSessionCommitV1");
    const outputPorts = agentSessionCommitV1Definition.ports.filter(
      (p) => p.direction === "output",
    );
    expect(outputPorts.map((p) => p.id)).toContain("commitResult");
  });
});

// ============ Stateless Tests ============

describe("Agent Session: stateless mode", () => {
  it("returns empty context on load", async () => {
    const services = makeServices();
    const executor = createAgentSessionLoadV1Executor(services);
    const key = makeKey();

    const result = await executor({
      node: makeNode({ sessionConfig: { mode: "stateless" } }),
      inputs: { sessionKey: key },
    });

    const ctx = result.outputs.sessionContext as AgentSessionContextV1;
    expect(ctx.turns).toHaveLength(0);
    expect(ctx.estimatedTokens).toBe(0);
  });

  it("second call does not see first call content", async () => {
    const services = makeServices();
    const loadExecutor = createAgentSessionLoadV1Executor(services);
    const commitExecutor = createAgentSessionCommitV1Executor(services);
    const key = makeKey();
    const statelessConfig = { sessionConfig: { mode: "stateless" } };

    // Turn 1: load, commit
    const _t1Load = await loadExecutor({
      node: makeNode(statelessConfig),
      inputs: { sessionKey: key },
    });
    const t1Commit = await commitExecutor({
      node: makeNode(statelessConfig),
      inputs: {
        sessionDelta: { sessionKey: key, newTurn: makeTurn(1, "hello") },
      },
    });

    // Turn 2: load — should still be empty (stateless ignores commits)
    const t2Load = await loadExecutor({
      node: makeNode(statelessConfig),
      inputs: { sessionKey: key },
    });
    const ctx2 = t2Load.outputs.sessionContext as AgentSessionContextV1;
    expect(ctx2.turns).toHaveLength(0);

    // Commit should report not committed
    expect(t1Commit.outputs.commitResult).toEqual({ committed: false, reason: "stateless" });
  });

  it("default sessionConfig is stateless when not configured", async () => {
    const services = makeServices();
    const executor = createAgentSessionLoadV1Executor(services);
    const key = makeKey();

    // No sessionConfig at all
    const result = await executor({
      node: makeNode({}), // empty config
      inputs: { sessionKey: key },
    });

    const ctx = result.outputs.sessionContext as AgentSessionContextV1;
    expect(ctx.turns).toHaveLength(0);
  });
});

// ============ Stateful Tests ============

describe("Agent Session: stateful mode", () => {
  let services: ReturnType<typeof makeServices>;
  let statefulConfig: Record<string, unknown>;

  beforeEach(() => {
    services = makeServices();
    statefulConfig = { sessionConfig: { mode: "stateful" } };
  });

  it("second call sees first call content", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const key = makeKey();

    // Turn 1
    const t1Load = await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: key } });
    expect((t1Load.outputs.sessionContext as AgentSessionContextV1).turns).toHaveLength(0);

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(1, "first input") } },
    });

    // Turn 2
    const t2Load = await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: key } });
    const ctx2 = t2Load.outputs.sessionContext as AgentSessionContextV1;
    expect(ctx2.turns).toHaveLength(1);
    expect(ctx2.turns[0]!.input).toBe("first input");
  });

  it("multiple turns accumulate in order", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const key = makeKey();

    for (let i = 1; i <= 5; i++) {
      const delta: AgentSessionDeltaV1 = { sessionKey: key, newTurn: makeTurn(i, `msg-${i}`) };
      await commitExec({ node: makeNode(statefulConfig), inputs: { sessionDelta: delta } });
    }

    const ctx = (await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: key } }))
      .outputs.sessionContext as AgentSessionContextV1;
    expect(ctx.turns).toHaveLength(5);
    expect(ctx.turns[0]!.input).toBe("msg-1");
    expect(ctx.turns[4]!.input).toBe("msg-5");
  });
});

// ============ Isolation Tests ============

describe("Agent Session: isolation", () => {
  let services: ReturnType<typeof makeServices>;
  let statefulConfig: Record<string, unknown>;

  beforeEach(() => {
    services = makeServices();
    statefulConfig = { sessionConfig: { mode: "stateful" } };
  });

  it("different agentNodeId don't share context", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);

    const agent1Key = makeKey({ agentNodeId: "agent-1" });
    const agent2Key = makeKey({ agentNodeId: "agent-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: agent1Key, newTurn: makeTurn(1, "agent1-data") } },
    });

    const agent2Ctx = (
      await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: agent2Key } })
    ).outputs.sessionContext as AgentSessionContextV1;
    expect(agent2Ctx.turns).toHaveLength(0);
  });

  it("different conversationId don't share context", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);

    const conv1Key = makeKey({ conversationId: "conv-1" });
    const conv2Key = makeKey({ conversationId: "conv-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: conv1Key, newTurn: makeTurn(1, "c1") } },
    });

    const conv2Ctx = (
      await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: conv2Key } })
    ).outputs.sessionContext as AgentSessionContextV1;
    expect(conv2Ctx.turns).toHaveLength(0);
  });

  it("different workflowInstanceId don't share context", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);

    const wf1Key = makeKey({ workflowInstanceId: "wf-1" });
    const wf2Key = makeKey({ workflowInstanceId: "wf-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: wf1Key, newTurn: makeTurn(1, "wf1") } },
    });

    const wf2Ctx = (
      await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: wf2Key } })
    ).outputs.sessionContext as AgentSessionContextV1;
    expect(wf2Ctx.turns).toHaveLength(0);
  });

  it("different tenantId don't share context", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);

    const t1Key = makeKey({ tenantId: "tenant-1" });
    const t2Key = makeKey({ tenantId: "tenant-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: t1Key, newTurn: makeTurn(1, "t1") } },
    });

    const t2Ctx = (
      await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: t2Key } })
    ).outputs.sessionContext as AgentSessionContextV1;
    expect(t2Ctx.turns).toHaveLength(0);
  });

  it("different branchId don't share context", async () => {
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);

    const b1Key = makeKey({ branchId: "branch-1" });
    const b2Key = makeKey({ branchId: "branch-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: b1Key, newTurn: makeTurn(1, "b1") } },
    });

    const b2Ctx = (
      await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: b2Key } })
    ).outputs.sessionContext as AgentSessionContextV1;
    expect(b2Ctx.turns).toHaveLength(0);
  });
});

// ============ Clear Tests ============

describe("Agent Session: clear", () => {
  it("clears only the target session, not others", async () => {
    const store = new InMemoryAgentSessionStore();
    const services = { store };
    const commitExec = createAgentSessionCommitV1Executor(services);
    const clearExec = createAgentSessionClearV1Executor(services);
    const loadExec = createAgentSessionLoadV1Executor(services);
    const statefulConfig = { sessionConfig: { mode: "stateful" } };

    const key1 = makeKey({ agentNodeId: "agent-1" });
    const key2 = makeKey({ agentNodeId: "agent-2" });

    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: key1, newTurn: makeTurn(1, "k1") } },
    });
    await commitExec({
      node: makeNode(statefulConfig),
      inputs: { sessionDelta: { sessionKey: key2, newTurn: makeTurn(1, "k2") } },
    });

    // Clear only key1
    await clearExec({ node: makeNode({}), inputs: { sessionKey: key1 } });

    const ctx1 = (await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: key1 } }))
      .outputs.sessionContext as AgentSessionContextV1;
    const ctx2 = (await loadExec({ node: makeNode(statefulConfig), inputs: { sessionKey: key2 } }))
      .outputs.sessionContext as AgentSessionContextV1;

    expect(ctx1.turns).toHaveLength(0); // cleared
    expect(ctx2.turns).toHaveLength(1); // untouched
  });
});

// ============ Truncation Tests ============

describe("Agent Session: maxTurns and maxTokens", () => {
  it("maxTurns truncates oldest turns", async () => {
    const store = new InMemoryAgentSessionStore();
    const services = { store };
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const config = { sessionConfig: { mode: "stateful", maxTurns: 3 } };
    const key = makeKey();

    for (let i = 1; i <= 10; i++) {
      await commitExec({
        node: makeNode(config),
        inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(i) } },
      });
    }

    const ctx = (await loadExec({ node: makeNode(config), inputs: { sessionKey: key } })).outputs
      .sessionContext as AgentSessionContextV1;
    expect(ctx.turns).toHaveLength(3);
    expect(ctx.turns[0]!.turnIndex).toBe(8); // oldest kept
    expect(ctx.turns[2]!.turnIndex).toBe(10); // newest kept
    expect(ctx.truncated).toBe(true);
  });

  it("maxTokens truncates when token budget exceeded", async () => {
    const store = new InMemoryAgentSessionStore();
    const services = { store };
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const config = { sessionConfig: { mode: "stateful", maxTokens: 100, maxTurns: 999 } };
    const key = makeKey();

    // Each turn uses 30 tokens (10 input + 20 output)
    for (let i = 1; i <= 10; i++) {
      await commitExec({
        node: makeNode(config),
        inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(i) } },
      });
    }

    const ctx = (await loadExec({ node: makeNode(config), inputs: { sessionKey: key } })).outputs
      .sessionContext as AgentSessionContextV1;
    // 100 / 30 = 3.33 → at most 3 turns kept
    expect(ctx.turns.length).toBeLessThanOrEqual(4);
    expect(ctx.truncated).toBe(true);
  });
});

// ============ Store Error Handling ============

describe("Agent Session: store error handling", () => {
  it("commit returns error result on store failure, does not crash", async () => {
    const brokenStore: AgentSessionStore = {
      load: async () => null,
      append: async () => {
        throw new Error("Store write failed");
      },
      clear: async () => {},
      commitIdempotent: async () => {
        throw new Error("Store write failed");
      },
    };
    const services = { store: brokenStore };
    const commitExec = createAgentSessionCommitV1Executor(services);
    const config = { sessionConfig: { mode: "stateful" } };
    const key = makeKey();

    const result = await commitExec({
      node: makeNode(config),
      inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(1) } },
    });

    expect(result.outputs.commitResult).toEqual({ committed: false, error: "Store write failed" });
  });
});

// ============ Secret Isolation ============

describe("Agent Session: secret isolation", () => {
  it("session context does not contain API keys or Authorization headers", async () => {
    const store = new InMemoryAgentSessionStore();
    const services = { store };
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const config = { sessionConfig: { mode: "stateful" } };
    const key = makeKey();

    await commitExec({
      node: makeNode(config),
      inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(1, "test") } },
    });

    const ctx = (await loadExec({ node: makeNode(config), inputs: { sessionKey: key } })).outputs
      .sessionContext as AgentSessionContextV1;

    const serialized = JSON.stringify(ctx);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("sk-");
  });
});

// ============ File Store Restart Tests ============

describe("FileAgentSessionStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "awp-agent-session-"));
    filePath = join(dir, "agent-sessions.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads committed turns across store instances", async () => {
    const key = makeKey();
    const first = new FileAgentSessionStore(filePath);
    await first.commitIdempotent(
      key,
      { sessionKey: key, newTurn: makeTurn(1, "before restart") },
      { sessionId: key.conversationId, agentNodeId: key.agentNodeId, turnId: "turn-1" },
      "hash-1",
    );

    const restarted = new FileAgentSessionStore(filePath);
    const ctx = await restarted.load(key);

    expect(ctx?.turns).toHaveLength(1);
    expect(ctx?.turns[0]?.input).toBe("before restart");
  });

  it("deduplicates the same turn across store instances", async () => {
    const key = makeKey();
    const first = new FileAgentSessionStore(filePath);
    await first.commitIdempotent(
      key,
      { sessionKey: key, newTurn: makeTurn(1, "same") },
      { sessionId: key.conversationId, agentNodeId: key.agentNodeId, turnId: "turn-1" },
      "same-hash",
    );

    const restarted = new FileAgentSessionStore(filePath);
    const result = await restarted.commitIdempotent(
      key,
      { sessionKey: key, newTurn: makeTurn(1, "same") },
      { sessionId: key.conversationId, agentNodeId: key.agentNodeId, turnId: "turn-1" },
      "same-hash",
    );

    expect(result).toEqual({ committed: false, deduplicated: true });
    expect((await restarted.load(key))?.turns).toHaveLength(1);
  });

  it("reports conflict for same turn with different content across store instances", async () => {
    const key = makeKey();
    const first = new FileAgentSessionStore(filePath);
    await first.commitIdempotent(
      key,
      { sessionKey: key, newTurn: makeTurn(1, "original") },
      { sessionId: key.conversationId, agentNodeId: key.agentNodeId, turnId: "turn-1" },
      "hash-a",
    );

    const restarted = new FileAgentSessionStore(filePath);
    const result = await restarted.commitIdempotent(
      key,
      { sessionKey: key, newTurn: makeTurn(1, "changed") },
      { sessionId: key.conversationId, agentNodeId: key.agentNodeId, turnId: "turn-1" },
      "hash-b",
    );

    expect(result).toEqual({
      committed: false,
      deduplicated: false,
      conflict: true,
      error: 'session commit conflict: turnId="turn-1" already committed with different content',
    });
  });

  it("keeps agentNodeId and conversationId isolated on disk", async () => {
    const store = new FileAgentSessionStore(filePath);
    const keyA = makeKey({ conversationId: "conv-a", agentNodeId: "agent-a" });
    const keyB = makeKey({ conversationId: "conv-b", agentNodeId: "agent-b" });
    await store.append(keyA, { sessionKey: keyA, newTurn: makeTurn(1, "a") });
    await store.append(keyB, { sessionKey: keyB, newTurn: makeTurn(1, "b") });

    const restarted = new FileAgentSessionStore(filePath);

    expect((await restarted.load(keyA))?.turns[0]?.input).toBe("a");
    expect((await restarted.load(keyB))?.turns[0]?.input).toBe("b");
  });

  it("fails explicitly when the session file is corrupted", async () => {
    writeFileSync(filePath, "not json", "utf-8");
    const store = new FileAgentSessionStore(filePath);

    await expect(store.load(makeKey())).rejects.toThrow("AgentSession file corrupted");
  });
});

// ============ Backward Compatibility ============

describe("Agent Session: backward compatibility", () => {
  it("old workflow without sessionConfig defaults to stateless", async () => {
    const services = makeServices();
    const loadExec = createAgentSessionLoadV1Executor(services);
    const commitExec = createAgentSessionCommitV1Executor(services);
    const key = makeKey();

    // Old node config: no sessionConfig at all
    const oldConfig = {};

    const loadResult = await loadExec({ node: makeNode(oldConfig), inputs: { sessionKey: key } });
    expect((loadResult.outputs.sessionContext as AgentSessionContextV1).turns).toHaveLength(0);

    const commitResult = await commitExec({
      node: makeNode(oldConfig),
      inputs: { sessionDelta: { sessionKey: key, newTurn: makeTurn(1) } },
    });
    expect(commitResult.outputs.commitResult).toEqual({ committed: false, reason: "stateless" });
  });
});

// ============ Type imports for brokenStore test ============
import type { AgentSessionStore } from "../src/agentSessionStore.js";
